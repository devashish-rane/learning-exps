# Compose Log Viewer

Lightweight FastAPI tool that scans the current git repository for Docker Compose services, lists the running containers, and shows tail logs per service in a clean HTML view.

## Features

- Automatically detects the repository root using `git rev-parse`.
- Searches for `docker-compose.yml|yaml` and `compose.yml|yaml` in the repo root to surface service names.
- Uses the Docker Engine API (via `docker` Python SDK) to list running containers, compose metadata, published ports, and health/status information.
- Sleek HTML/CSS/JS UI with a sidebar of services, host/container port badges (with one-click "Open" links), and a structured log viewer.
- Insight cards for CPU/memory gauges (with auto-updating sparklines), networking details (ports + docker networks), and compose metadata (depends_on, profiles).
- Insight cards for CPU/memory gauges (with auto-updating sparklines), networking details (ports + docker networks), compose metadata (depends_on, profiles), and a Compose topology overview (networks + dependency edges).
- Quick "Restart Service" button that triggers `docker restart` for the selected container and refreshes the log stream automatically.
- Tail selector (200/500/1000 lines) and optional auto-refresh (2s/5s/10s) keep logs up to date without reloading the page.

## Usage

```bash
cd log-viewer
make install
make dev            # runs uvicorn on port 5050
```

Alternatively, run the commands manually:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 5050
```

Open `http://localhost:5050` in your browser. The left sidebar shows running containers (with Compose service names when available). Click a service to stream logs in real time; the insights grid below shows:

- **CPU / Memory card** – live gauges and sparklines powered by `/api/stats/{id}` (updates every 2s).
- **Ports card** – host ↔ container mappings with "Open" links.
- **Networks card** – docker network names + aliases.
- **Compose card** – depends_on edges and active profiles parsed from your compose file.

Use the tail dropdown to control how many historical lines you want when a stream attaches. Logs continue streaming live via SSE (no manual refresh needed).

> Note: the app talks to your local Docker daemon. Ensure Docker Desktop/Engine is running and that your user has permission to access the Docker socket.
