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
└── frontend/                     # React SPA that consumes the backend APIs
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

### Frontend (React + Vite)

The React application lives under `tracking_compose/frontend` and is built with Vite. It ships four focused views that
exercise the FastAPI surface: Compose service management, health snapshots, HTTP percentile tables, and trace/log
correlation. All requests flow through a shared fetch helper that attaches an `X-Dockhand-Correlation-Id` header so we
can line up UI actions with backend logs when debugging incidents.

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

### Frontend Workflow

1. `cd tracking_compose/frontend`
2. Install dependencies once: `npm install`
3. Start the dev server (proxied to the FastAPI backend): `npm run dev`
   * By default, the SPA proxies `/api` calls to `http://localhost:4100`. Override this by exporting
     `VITE_API_BASE_URL` before running dev/build commands if your backend is hosted elsewhere—use host-only values
     (e.g. `https://dockhand.example.com`) so the client can append the `/api/*` paths without duplication.
4. Run type-checks: `npm run lint`

### Production Build Notes

* `npm run build` creates a static bundle in `frontend/dist` and respects `VITE_API_BASE_URL`. When serving the SPA and
  API from the same origin, leave the variable unset so requests resolve against `/api` relative to the host.
* `npm run preview` runs a production-like server on port `4173` to validate the bundle before pushing to staging.
* Because the fetch layer always sends an `X-Dockhand-Correlation-Id` header, ensure reverse proxies forward custom
  headers; otherwise backend diagnostics lose that linkage. Nginx/Traefik pass it through by default, but managed CDNs
  sometimes require an explicit allow list.

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
