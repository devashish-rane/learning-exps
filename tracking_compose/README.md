# Dockhand Tracking Compose Utility

The `tracking_compose` workspace houses the developer cockpit for orchestrating Docker Compose microservice
stacks. This revision aligns the implementation with a **React frontend + Python (FastAPI) backend** stack to match
the requested technology preferences while preserving the production-grade guardrails outlined in the product
requirements.

## Architecture Overview

```
tracking_compose/
├── README.md                     # Product vision & architecture (this file)
├── backend/                      # FastAPI daemon powering orchestration and telemetry APIs
│   ├── pyproject.toml            # Python packaging + tooling metadata
│   └── src/tracking_compose_backend/
│       ├── main.py               # FastAPI app factory, router wiring, lifespan management
│       ├── config.py             # Settings objects w/ env overrides and validation
│       ├── api/                  # REST handlers grouped by domain (services, health, telemetry, traces)
│       ├── services/             # Business logic for Compose, health polling, metrics, tracing
│       └── utils/                # Logging + diagnostic helpers for rich error surfacing
└── frontend/ (planned)           # React SPA that consumes the backend APIs (to be scaffolded next)
```

### Backend (FastAPI)

* **Responsibility** – talk to Docker Engine/Compose, Actuator, and tracing backends; expose typed REST endpoints for
  the UI; maintain background pollers for health and telemetry. The MVP endpoints now cover service lifecycle, health
  snapshots, dependency graphs, URL indices, latency tables, and trace/log correlation so the React shell can stay
  command-driven.
* **Observability** – structured Rich logging, Prometheus metrics, pluggable OpenTelemetry tracing, exhaustive
docstrings for faster debugging.
* **Resilience** – defensive diagnostics when Docker/Compose binaries are missing; background tasks isolated to avoid
  request latency spikes.

### Frontend (React) – Next Iteration

The frontend will be scaffolded as a Vite-powered React SPA that authenticates against the backend, renders the
control panel, live dashboards, and tracing visualizations. The backend already exposes CORS-friendly defaults for a
local dev server running on `localhost:5173`.

## Why React + Python is Optimal Here

1. **Team familiarity & velocity** – Most Dockhand contributors ship React SPAs backed by FastAPI services; matching
   that stack cuts onboarding time and avoids context switching.
2. **Ecosystem depth** – Python boasts mature Docker, metrics, and tracing clients while React offers the richest UI
   ecosystem (component libraries, visualization kits) for the dashboard-heavy UX.
3. **Deployment simplicity** – The FastAPI daemon can be containerized, packaged via PyInstaller, or embedded into a
   Tauri shell. React bundles cleanly into static assets that can be served by the backend or a CDN.
4. **Observability-first** – FastAPI integrates naturally with OpenTelemetry, Prometheus, and structured logging
   libraries, letting us meet the "optimize for easy debugging" requirement from day one.

## Development Workflow

1. `cd tracking_compose/backend`
2. Create a virtualenv: `python -m venv .venv && source .venv/bin/activate`
3. Install dependencies: `pip install -e .[dev]`
4. Launch the daemon: `uvicorn tracking_compose_backend.main:app --reload --port 4100`

The React frontend will follow with a Vite-based dev server listening on `5173`.

## Production Considerations

* **Configuration** – environment variables prefixed with `DOCKHAND_` let operators tune discovery roots, polling
  cadences, trace providers, Compose config cache TTLs, and log-correlation bounds without code changes.
* **Diagnostics** – failures raise `DiagnosticError` instances with remediation messages so the UI can display
  actionable guidance (e.g., "Install Docker Compose v2"). Health and telemetry pollers also surface the last error per
  service so the dashboard can show context instead of an opaque red tile.
* **Extensibility** – service managers encapsulate Compose, health, telemetry, and trace integrations, providing
  clear seams for future plug-ins (Kafka tooling, DB consoles, synthetic flows).

This update replaces the earlier TypeScript daemon with a Python counterpart that better suits the requested stack and
keeps documentation, logging, and failure handling front and center for an easier production rollout.
