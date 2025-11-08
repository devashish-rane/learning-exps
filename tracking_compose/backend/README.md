# Dockhand Tracking Compose Backend (Python)

This backend provides a FastAPI-based control plane for the Dockhand Tracking Compose utility. It replaces the
initial TypeScript scaffold with a Python implementation that aligns with the project's analytics-heavy workload,
leverages the Docker SDK for native Compose control, and matches the team's preferred Python + React stack.

## Why Python + React?

* **Operational familiarity** – the wider Dockhand team already ships FastAPI and React services; reusing the stack
  reduces onboarding friction and accelerates iteration.
* **Ecosystem fit** – Python offers first-class libraries for Docker Engine (`docker`), metrics aggregation
  (`prometheus_client`), and async HTTP work (`httpx`) required for health checks, Actuator polling, and tracing
  enrichment. React remains the most ergonomic frontend for building the interactive command center described in the
  requirements.
* **Observability tooling** – FastAPI integrates cleanly with OpenTelemetry exporters, enabling us to reuse the same
  instrumentation story across services and measure daemon latency.
* **Deployment flexibility** – The daemon can be packaged as a simple `uvicorn` process, a container, or bundled via
  PyInstaller alongside a desktop shell such as Tauri.

## Code Layout

```
backend/
├── pyproject.toml                  # PEP 621 metadata with runtime + tooling dependencies
└── src/tracking_compose_backend/
    ├── main.py                     # FastAPI app, lifecycle wiring, router inclusion
    ├── config.py                   # Pydantic settings (ports, polling cadence, discovery paths)
    ├── api/
    │   ├── __init__.py
    │   ├── dependencies.py         # Shared dependency injection wiring for routers
    │   ├── services.py             # Service lifecycle + dependency graph endpoints
    │   ├── health.py               # Health summaries & latency snapshots
    │   ├── telemetry.py            # Percentile views and metrics plumbing
    │   ├── topology.py             # Dependency graph + URL index helpers
    │   └── traces.py               # Trace retrieval with Jaeger+log fallback
    ├── services/
    │   ├── compose_manager.py      # Docker Engine orchestration, metadata enrichment, URL/index builders
    │   ├── health_monitor.py       # Async poller for service health endpoints (x-dev aware)
    │   ├── telemetry_aggregator.py # Aggregates Actuator percentiles and outcome ratios
    │   ├── trace_service.py        # Talks to Jaeger/OTel collectors with log correlation fallback
    │   └── models.py               # Domain models shared across services layer
    └── utils/
        ├── logging.py              # Structured Rich logging helpers
        └── diagnostics.py          # Error mappers that surface actionable remediation hints
```

All public functions and classes include docstrings with context about their role, guardrails, and notable failure
modes to simplify production debugging.

## Development Workflow

```bash
# Create and activate a virtual environment (uv or python -m venv are both fine)
python -m venv .venv
source .venv/bin/activate

# Install runtime + dev tooling
pip install -e .[dev]

# Run the API locally
uvicorn tracking_compose_backend.main:app --reload --port 4100
```

### Recommended Aux Services

* Docker Engine API (default socket `/var/run/docker.sock`) and Docker Compose v2 plugin available on `$PATH`.
* Optional: Jaeger (for tracing profiles) and Prometheus/Grafana for metrics visualization.

## Implemented Utility Features

* **Service discovery + lifecycle APIs** – `GET /api/services` merges Compose configs (respecting overrides and
  profiles), annotates x-dev metadata, and enriches each service with live container state. `POST /api/services/*`
  relays start/stop/restart actions while surfacing remediation-friendly diagnostics when Compose fails.
* **Dependency + URL topology** – `GET /api/deps` returns the depends_on graph along with reverse edges so the UI can
  answer "who breaks if X dies?". `GET /api/urls` exposes best-guess base, health, and docs URLs derived from published
  ports and x-dev hints to power the command palette.
* **Health polling** – The `HealthMonitor` respects x-dev health paths, prefers host-accessible URLs, and captures the
  error trail per service so the UI can display why a tile is red rather than simply failing silently.
* **Metrics aggregation** – `TelemetryAggregator` crawls `http.server.requests`, hydrates p50/p90/p99 percentiles when
  Actuator exposes them, and computes coarse error ratios by querying outcome tag combinations. The data set is bounded
  to a configurable number of endpoints to avoid overwhelming the UI.
* **Trace explorer fallback** – If Jaeger/Tempo is configured we parse spans into a normalized structure with critical
  path hints; otherwise we walk recent container logs (bounded by `log_correlation_tail_lines`) to highlight matching
  trace IDs, giving developers a lightweight correlator with zero extra infrastructure.

## Configuration Guardrails

The `Settings` hierarchy exposes a minimal but production-hardened surface area:

* `DOCKHAND_DOCKER_CONFIG_CACHE_TTL_SECONDS` – caches `docker compose config` output to avoid hammering the CLI while
  editing compose files.
* `DOCKHAND_TELEMETRY_HTTP_TIMEOUT_SECONDS` – bounds outbound health/metrics calls so a slow service cannot wedge the
  pollers.
* `DOCKHAND_TELEMETRY_LOG_CORRELATION_TAIL_LINES` – limits how much log data is scanned when Jaeger is offline.

All settings support environment overrides and inherit sane defaults for local development.

## Observability & Testing

* Structured Rich logging keeps error context readable locally while remaining JSON-friendly when redirected to files.
* Each service module centralizes diagnostics (e.g., Compose binary validation, HTTP error collection) so failures ship
  with remediation tips by default.
* `python -m compileall src` acts as a lightweight syntax gate for now; expanding to pytest/mypy/ruff is straightforward
  once the frontend scaffolding lands.

The backend now delivers the MVP surface required by the product brief while staying aligned with the "optimize for
debuggability" mandate.
