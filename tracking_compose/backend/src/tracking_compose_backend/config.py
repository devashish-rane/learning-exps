"""Runtime configuration models for the Dockhand Tracking Compose backend."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Sequence

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class DockerSettings(BaseSettings):
    """Settings that control how we communicate with the Docker Engine and Compose."""

    host: str = Field(
        default="unix:///var/run/docker.sock",
        description=(
            "Connection string for the Docker Engine API. Supports unix sockets and TCP endpoints."
        ),
    )
    compose_binary: str = Field(
        default="docker compose",
        description=(
            "Command used to invoke Compose. We shell out only after verifying the binary exists "
            "to fail fast with a human-friendly diagnostic."
        ),
    )
    discovery_roots: Annotated[Sequence[Path], Field(default_factory=lambda: (Path.cwd(),))] = Field(
        description=(
            "Directories that will be scanned for docker-compose*.yml files. Defaults to the current "
            "working tree so the daemon can be launched from any project checkout."
        )
    )
    config_cache_ttl_seconds: int = Field(
        default=5,
        ge=1,
        le=120,
        description=(
            "TTL for cached `docker compose config` responses. Compose resolution is expensive, so we "
            "reuse the merged view for a short window while still detecting file changes quickly."
        ),
    )

    model_config = SettingsConfigDict(env_prefix="DOCKHAND_DOCKER_")


class TelemetrySettings(BaseSettings):
    """Configuration for polling metrics, health endpoints, and trace providers."""

    health_poll_interval_seconds: int = Field(
        default=5,
        ge=1,
        le=60,
        description="Cadence for health endpoint polling. We clamp to avoid overloading services.",
    )
    metrics_poll_interval_seconds: int = Field(
        default=15,
        ge=5,
        le=120,
        description="Cadence for percentile aggregation sweeps from Actuator endpoints.",
    )
    trace_provider_url: HttpUrl | None = Field(
        default=None,
        description="Optional Jaeger or Tempo endpoint that powers the trace explorer UI.",
    )
    http_timeout_seconds: float = Field(
        default=5.0,
        ge=1.0,
        le=30.0,
        description="Timeout applied to health and telemetry HTTP calls to prevent runaway hangs.",
    )
    log_correlation_tail_lines: int = Field(
        default=200,
        ge=50,
        le=5000,
        description=(
            "When Jaeger is unavailable we fall back to scanning recent container logs; this caps the number "
            "of lines retrieved per container to avoid excessive payloads."
        ),
    )

    model_config = SettingsConfigDict(env_prefix="DOCKHAND_TELEMETRY_")


class ApiSettings(BaseSettings):
    """API-level configuration for the FastAPI application."""

    host: str = Field(default="0.0.0.0", description="Address uvicorn should bind to.")
    port: int = Field(default=4100, ge=1, le=65535, description="Port exposed for HTTP traffic.")
    enable_cors: bool = Field(
        default=True,
        description="Whether to allow cross-origin requests from the React frontend during development.",
    )
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173"],
        description="Whitelisted origins if CORS is enabled.",
    )

    model_config = SettingsConfigDict(env_prefix="DOCKHAND_API_")


class Settings(BaseSettings):
    """Top-level settings container that aggregates subsystem configuration."""

    docker: DockerSettings = Field(default_factory=DockerSettings)
    telemetry: TelemetrySettings = Field(default_factory=TelemetrySettings)
    api: ApiSettings = Field(default_factory=ApiSettings)

    model_config = SettingsConfigDict(env_prefix="DOCKHAND_", env_nested_delimiter="__")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached settings instance.

    We memoize settings because the underlying `BaseSettings` reads from the environment. Reusing a single
    instance avoids repeated disk and env lookups while ensuring tests can override values by clearing the
    cache.
    """

    return Settings()


__all__ = ["Settings", "get_settings", "DockerSettings", "TelemetrySettings", "ApiSettings"]
