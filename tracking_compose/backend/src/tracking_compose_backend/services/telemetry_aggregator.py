"""Aggregates percentile metrics from Spring Boot Actuator endpoints."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

import httpx

from tracking_compose_backend.config import TelemetrySettings
from tracking_compose_backend.services.compose_manager import ComposeServiceManager
from tracking_compose_backend.services.models import EndpointMetrics, ServiceMetadata
from tracking_compose_backend.utils.logging import Logger


class TelemetryAggregator:
    """Polls service metrics endpoints and computes derived statistics."""

    def __init__(
        self,
        settings: TelemetrySettings,
        compose_manager: ComposeServiceManager,
        logger: Logger,
    ) -> None:
        self._settings = settings
        self._compose_manager = compose_manager
        self._logger = logger
        self._task: asyncio.Task[None] | None = None
        self._metrics: dict[str, list[EndpointMetrics]] = defaultdict(list)

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:  # pragma: no cover
                pass
            self._task = None

    def latest(self) -> Mapping[str, list[EndpointMetrics]]:
        return {service: list(metrics) for service, metrics in self._metrics.items()}

    async def _poll_loop(self) -> None:
        while True:
            try:
                services = await self._compose_manager.discovered_services(include_status=False)
                async with httpx.AsyncClient(timeout=self._settings.http_timeout_seconds) as client:
                    tasks = [self._fetch_metrics(client, metadata) for metadata in services]
                    results = await asyncio.gather(*tasks, return_exceptions=True)

                for service_name, metrics in results:
                    if isinstance(metrics, Exception):
                        self._logger.warning(
                            "metrics_probe_failed",
                            extra={"service": service_name, "error": str(metrics)},
                        )
                        continue
                    self._metrics[service_name] = metrics
            except Exception as exc:  # pragma: no cover
                self._logger.exception("metrics_loop_crash", extra={"error": str(exc)})

            await asyncio.sleep(self._settings.metrics_poll_interval_seconds)

    async def _fetch_metrics(
        self, client: httpx.AsyncClient, metadata: ServiceMetadata
    ) -> tuple[str, list[EndpointMetrics] | Exception]:
        urls: Sequence[str] = metadata.metrics_urls
        errors: list[str] = []
        for url in urls:
            try:
                response = await client.get(url)
                response.raise_for_status()
                payload: dict[str, Any] = response.json()
                metrics = await self._extract_endpoint_metrics(client, url, metadata, payload)
                return metadata.name, metrics
            except httpx.HTTPError as exc:
                errors.append(f"{url}: {exc}")
        return metadata.name, RuntimeError("; ".join(errors) if errors else "metrics endpoint unavailable")

    async def _extract_endpoint_metrics(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        metadata: ServiceMetadata,
        payload: dict[str, Any],
    ) -> list[EndpointMetrics]:
        uri_candidates = _tag_values(payload, "uri")
        method_candidates = _tag_values(payload, "method")
        if not uri_candidates or not method_candidates:
            return []

        metrics: list[EndpointMetrics] = []
        for uri in uri_candidates[: _MAX_ENDPOINTS]:
            if uri in {"UNKNOWN", "root", "/*"} or uri.startswith("/actuator"):
                continue
            for method in method_candidates:
                datapoint = await self._query_endpoint_metrics(client, base_url, metadata.name, method, uri)
                if datapoint:
                    metrics.append(datapoint)
        return metrics

    async def _query_endpoint_metrics(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        service_name: str,
        method: str,
        uri: str,
    ) -> EndpointMetrics | None:
        params = [
            ("tag", f"uri:{uri}"),
            ("tag", f"method:{method}"),
        ]
        percentiles = ["0.5", "0.9", "0.99"]
        for pct in percentiles:
            params.append(("percentile", pct))
        try:
            response = await client.get(base_url, params=params)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            self._logger.debug(
                "metrics_query_failed",
                extra={"service": service_name, "uri": uri, "method": method, "error": str(exc)},
            )
            return None

        data = response.json()
        measurements = {item.get("statistic"): item.get("value") for item in data.get("measurements", [])}
        count = measurements.get("COUNT")
        percentile_values = _extract_percentiles(data)

        success_count = await self._query_outcome_count(client, base_url, method, uri, "SUCCESS")
        error_count = await self._query_outcome_count(client, base_url, method, uri, "SERVER_ERROR")
        total = (success_count or 0) + (error_count or 0) or count
        error_rate = (error_count or 0) / total if total else None

        return EndpointMetrics(
            service_name=service_name,
            method=method,
            path=uri,
            p50_ms=_seconds_to_ms(percentile_values.get("0.5")),
            p90_ms=_seconds_to_ms(percentile_values.get("0.9")),
            p99_ms=_seconds_to_ms(percentile_values.get("0.99")),
            rps=None,
            error_rate=error_rate,
            downstream_share=None,
            self_share=None,
            sample_size=int(count) if isinstance(count, (int, float)) else None,
        )

    async def _query_outcome_count(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        method: str,
        uri: str,
        outcome: str,
    ) -> int | None:
        params = [("tag", f"uri:{uri}"), ("tag", f"method:{method}"), ("tag", f"outcome:{outcome}")]
        try:
            response = await client.get(base_url, params=params)
            response.raise_for_status()
        except httpx.HTTPError:
            return None
        data = response.json()
        for measurement in data.get("measurements", []):
            if measurement.get("statistic") == "COUNT":
                value = measurement.get("value")
                if isinstance(value, (int, float)):
                    return int(value)
        return None


__all__ = ["TelemetryAggregator"]


_MAX_ENDPOINTS = 12


def _tag_values(payload: Mapping[str, Any], tag_name: str) -> list[str]:
    for tag in payload.get("availableTags", []):
        if tag.get("tag") == tag_name:
            return [str(value) for value in tag.get("values", [])]
    return []


def _extract_percentiles(payload: Mapping[str, Any]) -> dict[str, float]:
    percentile_values: dict[str, float] = {}
    for tag in payload.get("availableTags", []):
        if tag.get("tag") == "percentile":
            for value in tag.get("values", []):
                percentile_values[str(value)] = 0.0
    for measurement in payload.get("measurements", []):
        statistic = measurement.get("statistic")
        if statistic == "VALUE":
            percentile = str(measurement.get("percentile")) if "percentile" in measurement else None
            if percentile:
                percentile_values[percentile] = float(measurement.get("value", 0.0))
        elif statistic and statistic.startswith("PERCENTILE_"):
            # Micrometer can embed percentile stats directly as PERCENTILE_50, etc.
            percentile = statistic.split("PERCENTILE_")[-1].replace("_", ".")
            percentile_values[percentile] = float(measurement.get("value", 0.0))
    return percentile_values


def _seconds_to_ms(value: float | None) -> float | None:
    if value is None:
        return None
    return value * 1000.0
