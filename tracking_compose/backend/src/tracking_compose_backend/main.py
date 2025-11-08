"""FastAPI application factory for the Dockhand backend."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tracking_compose_backend.api import health, services, telemetry, topology, traces
from tracking_compose_backend.api.dependencies import (
    AppState,
    lifespan_dependencies,
    settings,
)
from tracking_compose_backend.config import Settings
from tracking_compose_backend.utils.logging import get_logger


def create_app(app_settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""

    app_settings = app_settings or settings()
    logger = get_logger()
    logger.info("starting dockhand backend", extra={"port": app_settings.api.port})

    async def lifespan(app: FastAPI):
        async with lifespan_dependencies(app_settings) as state:
            app.state.dockhand_state = state
            yield
            del app.state.dockhand_state

    app = FastAPI(title="Dockhand Tracking Compose", lifespan=lifespan)

    if app_settings.api.enable_cors:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=app_settings.api.allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(services.router)
    app.include_router(health.router)
    app.include_router(telemetry.router)
    app.include_router(topology.router)
    app.include_router(traces.router)

    @app.get("/healthz")
    async def readiness() -> dict[str, str]:  # pragma: no cover - trivial
        return {"status": "ok"}

    return app


app = create_app()

__all__ = ["create_app", "app"]
