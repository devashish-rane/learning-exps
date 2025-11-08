"""Trace retrieval utilities."""

from __future__ import annotations

import httpx

from tracking_compose_backend.config import TelemetrySettings
from tracking_compose_backend.services.compose_manager import ComposeServiceManager
from tracking_compose_backend.services.models import TraceLogCorrelation, TraceSpan, TraceSummary
from tracking_compose_backend.utils.logging import Logger


class TraceService:
    """Fetches traces from the configured tracing backend and falls back to log correlation."""

    def __init__(
        self,
        settings: TelemetrySettings,
        compose_manager: ComposeServiceManager,
        logger: Logger,
    ) -> None:
        self._settings = settings
        self._compose_manager = compose_manager
        self._logger = logger
        self._client: httpx.AsyncClient | None = None

    async def aclose(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _client_instance(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client

    async def fetch_trace(self, trace_id: str) -> dict[str, object]:
        """Return a trace payload or fall back to log correlation when tracing is disabled."""

        if self._settings.trace_provider_url is None:
            lines = await self._compose_manager.logs_for_trace(
                trace_id, self._settings.log_correlation_tail_lines
            )
            correlation = TraceLogCorrelation(trace_id=trace_id, lines=tuple(lines))
            return {
                "mode": "logs",
                "trace_id": correlation.trace_id,
                "lines": list(correlation.lines),
            }

        client = await self._client_instance()
        url = f"{self._settings.trace_provider_url}/api/traces/{trace_id}"
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            self._logger.warning(
                "trace_provider_error",
                extra={"trace_id": trace_id, "url": url, "error": str(exc)},
            )
            lines = await self._compose_manager.logs_for_trace(
                trace_id, self._settings.log_correlation_tail_lines
            )
            return {
                "mode": "logs",
                "trace_id": trace_id,
                "lines": lines,
            }

        payload = response.json()
        summary = _summarize_trace(payload, trace_id)
        return {
            "mode": "trace",
            "trace_id": summary.trace_id,
            "duration_ms": summary.duration_ms,
            "critical_path_services": list(summary.critical_path_services),
            "spans": [
                {
                    "service": span.service,
                    "operation": span.operation,
                    "duration_ms": span.duration_ms,
                    "start_time_ms": span.start_time_ms,
                    "tags": dict(span.tags),
                }
                for span in summary.spans
            ],
        }


__all__ = ["TraceService"]


def _summarize_trace(payload: dict[str, object], trace_id: str) -> TraceSummary:
    """Parse Jaeger/Tempo JSON into a :class:`TraceSummary`."""

    data = (payload or {}).get("data") or []
    if not data:
        return TraceSummary(trace_id=trace_id, duration_ms=0.0, critical_path_services=tuple(), spans=[])

    trace = data[0]
    processes = {pid: proc.get("serviceName") for pid, proc in trace.get("processes", {}).items()}
    spans: list[TraceSpan] = []
    service_durations: dict[str, float] = {}

    for span_payload in trace.get("spans", []):
        process_id = span_payload.get("processID")
        service = processes.get(process_id, "unknown")
        duration_us = span_payload.get("duration") or 0
        duration_ms = float(duration_us) / 1000.0
        start_time = int((span_payload.get("startTime") or 0) / 1000)
        tags = {tag.get("key"): tag.get("value") for tag in span_payload.get("tags", [])}
        spans.append(
            TraceSpan(
                service=service,
                operation=span_payload.get("operationName", "unknown"),
                duration_ms=duration_ms,
                start_time_ms=start_time,
                tags=tags,
            )
        )
        service_durations[service] = service_durations.get(service, 0.0) + duration_ms

    critical_path_services = tuple(
        sorted(service_durations, key=service_durations.get, reverse=True)[:3]
    )
    if spans:
        start_min = min(span.start_time_ms for span in spans)
        end_max = max(span.start_time_ms + span.duration_ms for span in spans)
        overall_duration = end_max - start_min
    else:
        overall_duration = 0.0

    return TraceSummary(
        trace_id=trace_id,
        duration_ms=overall_duration,
        critical_path_services=critical_path_services,
        spans=spans,
    )
