"""Background health polling logic."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any

import httpx

from tracking_compose_backend.config import TelemetrySettings
from tracking_compose_backend.services.compose_manager import ComposeServiceManager
from tracking_compose_backend.services.models import HealthSnapshot, ServiceMetadata
from tracking_compose_backend.utils.diagnostics import DiagnosticError
from tracking_compose_backend.utils.logging import Logger


class HealthMonitor:
    """Periodically polls service health endpoints and caches the latest snapshot."""

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
        self._snapshots: dict[str, HealthSnapshot] = {}

    async def start(self) -> None:
        """Start the background polling task if not already running."""

        if self._task is None:
            self._task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        """Cancel the polling task."""

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:  # pragma: no cover - deterministic cancellation
                pass
            self._task = None

    def latest(self) -> Mapping[str, HealthSnapshot]:
        """Return the most recent health snapshots keyed by service name."""

        return dict(self._snapshots)

    async def _poll_loop(self) -> None:
        """Run the health polling loop until cancelled."""

        while True:
            try:
                services = await self._compose_manager.discovered_services(include_status=False)
                async with httpx.AsyncClient(timeout=self._settings.http_timeout_seconds) as client:
                    tasks = [self._probe_service(client, metadata) for metadata in services]
                    results = await asyncio.gather(*tasks, return_exceptions=True)

                for result in results:
                    if isinstance(result, HealthSnapshot):
                        self._snapshots[result.service_name] = result
                    elif isinstance(result, Exception):
                        self._logger.warning(
                            "health_probe_failed",
                            extra={"error": str(result)},
                        )
            except DiagnosticError as diagnostic:
                self._logger.error("health_loop_diagnostic", extra=diagnostic.to_extra())
            except Exception as exc:  # pragma: no cover - defensive catch for rare bugs
                self._logger.exception("health_loop_crash", extra={"error": str(exc)})

            await asyncio.sleep(self._settings.health_poll_interval_seconds)

    async def _probe_service(
        self, client: httpx.AsyncClient, metadata: ServiceMetadata
    ) -> HealthSnapshot:
        """Probe the configured health endpoints for a service.

        We try host-based URLs first so developers running the daemon on the host machine get fast feedback without
        wiring the backend into the Compose network. If those fail we fall back to the internal DNS address.
        """

        urls: Sequence[str] = metadata.health_urls or (f"http://{metadata.name}:{_DEFAULT_PORT_GUESS}/actuator/health",)
        errors: list[str] = []
        for url in urls:
            try:
                response = await client.get(url)
                response.raise_for_status()
                payload: dict[str, Any] = response.json()
                return HealthSnapshot(
                    service_name=metadata.name,
                    healthy=True,
                    latency_ms=response.elapsed.total_seconds() * 1000,
                    status_code=response.status_code,
                    url=url,
                    details=payload,
                )
            except httpx.HTTPStatusError as exc:
                errors.append(f"{url}: {exc.response.status_code}")
            except httpx.RequestError as exc:
                errors.append(f"{url}: {exc}")

        return HealthSnapshot(
            service_name=metadata.name,
            healthy=False,
            latency_ms=0.0,
            status_code=None,
            url=urls[0] if urls else None,
            details={"errors": errors} if errors else {"error": "Health endpoint unreachable"},
        )


_DEFAULT_PORT_GUESS = 8080


__all__ = ["HealthMonitor"]
