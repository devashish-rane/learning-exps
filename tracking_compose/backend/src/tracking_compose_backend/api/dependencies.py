"""Shared FastAPI dependency providers and application lifespan management."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import Depends, Request

from tracking_compose_backend.config import Settings, get_settings
from tracking_compose_backend.services.compose_manager import ComposeServiceManager
from tracking_compose_backend.services.health_monitor import HealthMonitor
from tracking_compose_backend.services.telemetry_aggregator import TelemetryAggregator
from tracking_compose_backend.services.trace_service import TraceService
from tracking_compose_backend.utils.logging import get_logger


@dataclass(slots=True)
class AppState:
    """Holds singletons that should be reused across requests."""

    compose_manager: ComposeServiceManager
    health_monitor: HealthMonitor
    telemetry: TelemetryAggregator
    trace_service: TraceService


def settings() -> Settings:
    """Expose the cached settings instance for dependency injection."""

    return get_settings()


@asynccontextmanager
async def lifespan_dependencies(app_settings: Settings) -> AsyncIterator[AppState]:
    """Construct expensive collaborators once at startup and dispose them during shutdown."""

    logger = get_logger()
    compose_manager = ComposeServiceManager(settings=app_settings.docker, logger=logger)
    health_monitor = HealthMonitor(
        settings=app_settings.telemetry,
        compose_manager=compose_manager,
        logger=logger,
    )
    telemetry = TelemetryAggregator(
        settings=app_settings.telemetry,
        compose_manager=compose_manager,
        logger=logger,
    )
    traces = TraceService(
        settings=app_settings.telemetry,
        compose_manager=compose_manager,
        logger=logger,
    )

    await health_monitor.start()
    await telemetry.start()

    try:
        yield AppState(
            compose_manager=compose_manager,
            health_monitor=health_monitor,
            telemetry=telemetry,
            trace_service=traces,
        )
    finally:
        await health_monitor.stop()
        await telemetry.stop()
        await compose_manager.aclose()
        await traces.aclose()


def app_state(request: Request) -> AppState:
    """Fetch the lazily constructed :class:`AppState` from FastAPI's lifespan."""

    state = getattr(request.app.state, "dockhand_state", None)
    assert isinstance(state, AppState), "App state missing; ensure lifespan wiring executed."
    return state


def compose_manager_dep(state: AppState = Depends(app_state)) -> ComposeServiceManager:
    """Return the Compose manager singleton."""

    return state.compose_manager


def health_monitor_dep(state: AppState = Depends(app_state)) -> HealthMonitor:
    """Return the health monitor singleton."""

    return state.health_monitor


def telemetry_dep(state: AppState = Depends(app_state)) -> TelemetryAggregator:
    """Return the telemetry aggregator singleton."""

    return state.telemetry


def trace_service_dep(state: AppState = Depends(app_state)) -> TraceService:
    """Return the trace service singleton."""

    return state.trace_service


__all__ = [
    "AppState",
    "settings",
    "lifespan_dependencies",
    "compose_manager_dep",
    "health_monitor_dep",
    "telemetry_dep",
    "trace_service_dep",
]
