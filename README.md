# Local Microservice Chain

Three local services mimic a simple UI → Core API → Producer flow so we can practice synchronous hops, observability, and fast feedback.

## Services

| Service | Tech | Port | Description |
|---------|------|------|-------------|
| `ui` | React + Vite | 3000 | Frontend that fetches user data from the core API and renders login state. Hot reload friendly. |
| `core-spring-service` | Spring Boot 3 | 8080 | Aggregates user profile data and calls the producer service with correlation IDs. Provides `/api/user/{id}` and `/api/proxy/producer-health`. |
| `producer-service` | Spring Boot 3 | 8082 | Returns `{ userId, loggedIn }` and exposes `/health`. Can simulate latency/instability via query params. |

All services are wired together via Docker Compose on the `app-net` network and communicate via service names (e.g., `http://producer-service:8082`).

## Prerequisites

- Docker + Docker Compose
- Node.js 20+ (for local UI dev outside containers)
- Java 17 + Maven 3.9+

## Quick start

```bash
# 1. Build images (optional – `make up` will build if missing)
make build

# 2. Launch the stack
make up

# 3. Open the UI
open http://localhost:3000

# 4. Hit the core API directly
curl -H "X-Correlation-Id: demo" http://localhost:8080/api/user/demo

# 5. Stop everything
make down
```

## Make targets

- `make up` – start all services (`ui`, `core-service`, `producer-service`).
- `make down` – stop and remove containers.
- `make build` / `make rebuild` – build images (optionally without cache).
- `make logs SERVICE=core-service` – tail logs for a specific container.
- `make test` – simple smoke test that waits a moment and curls `core-service` (which, in turn, calls the producer).

## Configuration

A single `.env` in the repo root drives docker-compose and defaults:

```
CORE_PORT=8080
PRODUCER_PORT=8082
UI_PORT=3000
CORE_SERVICE_URL=http://core-service:${CORE_PORT}
PRODUCER_SERVICE_URL=http://producer-service:${PRODUCER_PORT}
VITE_CORE_URL=http://core-service:${CORE_PORT}
```

Adjust ports/URLs there and re-run `make up`. Core/Producer also expose standard health endpoints (`/actuator/health` and `/health`). Correlation IDs (`X-Correlation-Id`) are generated upstream if missing and propagated end-to-end.

## Local development tips

- UI dev without Docker:
  ```bash
  cd ui
  npm install
  npm run dev
  ```
- Core service dev (hot reload via devtools):
  ```bash
  cd core-spring-service
  ./mvnw spring-boot:run
  ```
- Producer service dev:
  ```bash
  cd producer-service
  ./mvnw spring-boot:run
  ```
- Update `.env` if you’re running services outside Docker so they point to `localhost` equivalents.

## Observability & error handling

- Every incoming request gets a correlation ID. The header is added to downstream calls and responses for easy tracing.
- If the producer service is down or times out, the core API replies with `503 { "error": "Producer Unavailable" }`.
- UI shows a fallback message and health badges when the producer/core endpoints cannot be reached.

## Next steps

- Add integration tests (Postman, k6, or curl scripts) to the `make test` target.
- Introduce latency/failure toggles in the UI to exercise resilience.
- Share typed DTOs in a `contracts/` folder so UI/Core stay in sync.
