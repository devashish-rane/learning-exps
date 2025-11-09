import json
import subprocess
import time
from collections import defaultdict
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

import docker
import yaml
from docker.errors import DockerException
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TEMPLATES = Environment(
    loader=FileSystemLoader(str(ROOT / "templates")),
    autoescape=select_autoescape(["html", "xml"]),
)

app = FastAPI(title="Compose Log Viewer", version="0.1.0")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def git_root() -> Path:
    try:
        output = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], cwd=ROOT, text=True
        )
        return Path(output.strip())
    except Exception:  # pragma: no cover
        return ROOT.parent


def find_compose_files() -> List[Path]:
    root = git_root()
    candidates = [
        root / "docker-compose.yml",
        root / "docker-compose.yaml",
        root / "compose.yml",
        root / "compose.yaml",
    ]
    return [p for p in candidates if p.exists()]


@lru_cache
def parse_services_from_compose() -> List[str]:
    services: List[str] = []
    for file in find_compose_files():
        try:
            data = yaml.safe_load(file.read_text()) or {}
            if isinstance(data, dict) and "services" in data and isinstance(data["services"], dict):
                services.extend(data["services"].keys())
        except yaml.YAMLError:
            continue
    return sorted(set(services))


@lru_cache
def parse_compose_metadata() -> dict:
    meta: Dict[str, dict] = {}
    for file in find_compose_files():
        try:
            data = yaml.safe_load(file.read_text()) or {}
        except yaml.YAMLError:
            continue
        services = data.get("services", {}) if isinstance(data, dict) else {}
        if not isinstance(services, dict):
            continue
        for name, svc in services.items():
            if not isinstance(svc, dict):
                continue
            entry = meta.setdefault(name, {"depends_on": set(), "networks": set(), "profiles": set()})
            depends = svc.get("depends_on")
            if isinstance(depends, dict):
                entry["depends_on"].update(depends.keys())
            elif isinstance(depends, list):
                entry["depends_on"].update(depends)
            networks = svc.get("networks")
            if isinstance(networks, dict):
                entry["networks"].update(networks.keys())
            elif isinstance(networks, list):
                entry["networks"].update(networks)
            profiles = svc.get("profiles")
            if isinstance(profiles, list):
                entry["profiles"].update(str(p) for p in profiles)
            elif isinstance(profiles, str):
                entry["profiles"].add(profiles)
    return {
        name: {
            "depends_on": sorted(info["depends_on"]),
            "networks": sorted(info["networks"]),
            "profiles": sorted(info["profiles"]),
        }
        for name, info in meta.items()
    }


@lru_cache
def parse_compose_networks() -> dict:
    networks: Dict[str, set] = {}
    for file in find_compose_files():
        try:
            data = yaml.safe_load(file.read_text()) or {}
        except yaml.YAMLError:
            continue
        services = data.get("services", {}) if isinstance(data, dict) else {}
        if not isinstance(services, dict):
            continue
        for name, svc in services.items():
            if not isinstance(svc, dict):
                continue
            nets = svc.get("networks")
            if isinstance(nets, dict):
                iterable = nets.keys()
            elif isinstance(nets, list):
                iterable = nets
            else:
                iterable = []
            for net in iterable:
                networks.setdefault(str(net), set()).add(name)
    return {net: sorted(services) for net, services in networks.items()}


def docker_client():
    try:
        return docker.from_env()
    except DockerException as exc:
        raise HTTPException(status_code=500, detail=f"Docker error: {exc}") from exc
 

def parse_trace_line(line: str) -> Optional[dict]:
    if "TRACE_SUMMARY" not in line:
        return None
    try:
        outer = json.loads(line)
    except json.JSONDecodeError:
        return None
    summary = outer
    if summary.get("event") != "TRACE_SUMMARY":
        message = outer.get("message")
        if isinstance(message, str):
            try:
                summary = json.loads(message)
            except json.JSONDecodeError:
                return None
    if summary.get("event") != "TRACE_SUMMARY":
        return None
    trace_id = summary.get("traceId")
    if not trace_id:
        return None
    timestamp = summary.get("ts") or outer.get("@timestamp") or datetime.utcnow().isoformat() + "Z"
    epoch = _ts_to_epoch(timestamp)
    return {
        "traceId": trace_id,
        "service": summary.get("service") or outer.get("service"),
        "requestName": summary.get("requestName"),
        "timeline": summary.get("timeline"),
        "ts": timestamp,
        "tsEpoch": epoch,
    }


def _ts_to_epoch(value: str) -> float:
    try:
        sanitized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(sanitized).timestamp()
    except ValueError:
        return 0.0


def _parse_line_timestamp(line: str) -> Optional[str]:
    """Try to extract an ISO timestamp from a docker log line.

    When docker logs are requested with timestamps=True, each line is prefixed
    with an RFC3339 timestamp, e.g. '2025-11-09T07:16:28.123456789Z ...'.
    Fallback to JSON '@timestamp' or 'ts' fields if present.
    """
    # Attempt docker-provided prefix (up to first space)
    try:
        if " " in line and line[0].isdigit():
            prefix, _rest = line.split(" ", 1)
            # Basic validation
            if "T" in prefix and (prefix.endswith("Z") or "+" in prefix):
                # Normalize possible nano-precision by trimming to microseconds if needed
                # Keep as-is; downstream will handle parsing
                return prefix
    except Exception:
        pass
    # Try to parse as JSON and pull timestamp-ish fields
    try:
        obj = json.loads(line)
        for key in ("@timestamp", "ts", "timestamp"):
            val = obj.get(key)
            if isinstance(val, str) and val:
                return val
    except Exception:
        # ignore non-JSON lines
        return None
    return None


def collect_trace_logs(trace_id: str, tail: int = 800, since: Optional[int] = None) -> List[dict]:
    """Collect and merge logs across all containers that contain trace_id.

    Returns a list of entries: { ts, tsEpoch, service, container, line }
    sorted by tsEpoch ascending.
    """
    client = docker_client()
    containers = client.containers.list()
    results: List[dict] = []
    for container in containers:
        service_label = container.labels.get("com.docker.compose.service", container.name)
        try:
            kwargs = {"tail": tail, "timestamps": True}
            if since is not None:
                kwargs["since"] = since
            logs = container.logs(**kwargs)
        except DockerException:
            continue
        if isinstance(logs, bytes):
            logs = logs.decode("utf-8", errors="ignore")
        for raw in logs.splitlines():
            if not raw or trace_id not in raw:
                continue
            ts = _parse_line_timestamp(raw) or datetime.utcnow().isoformat() + "Z"
            epoch = _ts_to_epoch(ts)
            # If docker added a timestamp prefix, strip it from the line payload for readability
            if raw and raw[0].isdigit() and " " in raw:
                maybe_prefix, rest = raw.split(" ", 1)
                if "T" in maybe_prefix and (maybe_prefix.endswith("Z") or "+" in maybe_prefix):
                    raw = rest
            results.append(
                {
                    "ts": ts,
                    "tsEpoch": epoch,
                    "service": service_label,
                    "container": container.name,
                    "line": raw,
                }
            )
    results.sort(key=lambda e: e.get("tsEpoch", 0))
    return results


def collect_traces(limit: int = 20, tail: int = 400) -> List[dict]:
    client = docker_client()
    containers = client.containers.list()
    grouped: Dict[str, List[dict]] = defaultdict(list)
    for container in containers:
        service_label = labels = container.labels.get("com.docker.compose.service", container.name)
        try:
            logs = container.logs(tail=tail)
        except DockerException:
            continue
        if isinstance(logs, bytes):
            logs = logs.decode("utf-8", errors="ignore")
        for line in logs.splitlines():
            entry = parse_trace_line(line)
            if not entry:
                continue
            entry["service"] = service_label
            grouped[entry["traceId"]].append(entry)
    requests = []
    for trace_id, entries in grouped.items():
        entries.sort(key=lambda e: e.get("tsEpoch", 0))
        request_name = next((e.get("requestName") for e in entries if e.get("requestName")), "Request")
        requests.append(
            {
                "traceId": trace_id,
                "requestName": request_name,
                "firstTs": entries[0].get("ts"),
                "firstEpoch": entries[0].get("tsEpoch", 0),
                "entries": [
                    {
                        "service": e.get("service"),
                        "timeline": e.get("timeline"),
                        "ts": e.get("ts"),
                    }
                    for e in entries
                ],
            }
        )
    requests.sort(key=lambda r: r.get("firstEpoch", 0), reverse=True)
    return requests[:limit]


@app.get("/", response_class=HTMLResponse)
async def home():
    template = TEMPLATES.get_template("index.html")
    html = template.render(
        services=parse_services_from_compose(),
        compose_files=find_compose_files(),
        git_root=str(git_root()),
        static_version=str(int(time.time())),
    )
    return HTMLResponse(content=html)


@app.get("/tracking", response_class=HTMLResponse)
async def tracking():
    template = TEMPLATES.get_template("tracking.html")
    html = template.render(git_root=str(git_root()), static_version=str(int(time.time())))
    return HTMLResponse(content=html)


@app.get("/api/traces")
async def traces(limit: int = Query(20, ge=1, le=200), tail: int = Query(400, ge=50, le=2000)):
    return {"requests": collect_traces(limit=limit, tail=tail)}


@app.get("/api/traces/{trace_id}/logs")
async def trace_logs(trace_id: str, tail: int = Query(800, ge=50, le=5000), since: Optional[int] = Query(None, ge=0)):
    if not trace_id or len(trace_id) < 6:
        raise HTTPException(status_code=400, detail="Invalid trace id")
    lines = collect_trace_logs(trace_id=trace_id, tail=tail, since=since)
    return {"traceId": trace_id, "count": len(lines), "lines": lines}


@app.get("/api/services")
async def list_services():
    client = docker_client()
    containers = client.containers.list()
    compose_info = parse_compose_metadata()
    payload = []
    for container in containers:
        labels = container.labels or {}
        state = container.attrs.get("State", {})
        health = state.get("Health", {}).get("Status")
        ports = []
        port_map = (
            container.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}
        )
        for container_port, mappings in port_map.items():
            if mappings:
                for mapping in mappings:
                    ports.append(
                        {
                            "containerPort": container_port,
                            "host": mapping.get("HostIp"),
                            "hostPort": mapping.get("HostPort"),
                            "protocol": container_port.split("/")[-1],
                        }
                    )
            else:
                ports.append(
                    {
                        "containerPort": container_port,
                        "host": None,
                        "hostPort": None,
                        "protocol": container_port.split("/")[-1],
                    }
                )
        network_info = []
        networks = container.attrs.get("NetworkSettings", {}).get("Networks", {}) or {}
        for name, data in networks.items():
            network_info.append(
                {
                    "name": name,
                    "ip": data.get("IPAddress"),
                    "ipv6": data.get("GlobalIPv6Address"),
                    "mac": data.get("MacAddress"),
                    "aliases": data.get("Aliases") or [],
                }
            )
        service_name = labels.get("com.docker.compose.service", container.name)
        compose_meta = compose_info.get(service_name, {})
        payload.append(
            {
                "id": container.id,
                "shortId": container.short_id,
                "name": container.name,
                "service": service_name,
                "project": labels.get("com.docker.compose.project"),
                "status": container.status,
                "state": state.get("Status"),
                "health": health,
                "ports": ports,
                "networks": network_info,
                "compose": compose_meta,
            }
        )
    return payload


@app.get("/api/topology")
async def topology():
    return {
        "services": parse_compose_metadata(),
        "networks": parse_compose_networks(),
    }


def _format_cpu_percent(stats: Dict) -> float:
    cpu_stats = stats.get("cpu_stats", {})
    precpu_stats = stats.get("precpu_stats", {})
    cpu_total = cpu_stats.get("cpu_usage", {}).get("total_usage", 0)
    precpu_total = precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
    system = cpu_stats.get("system_cpu_usage", 0)
    presystem = precpu_stats.get("system_cpu_usage", 0)
    cpu_delta = cpu_total - precpu_total
    system_delta = system - presystem
    percpu = cpu_stats.get("cpu_usage", {}).get("percpu_usage") or []
    num_cpus = len(percpu) or cpu_stats.get("online_cpus") or 1
    if cpu_delta > 0 and system_delta > 0:
        return (cpu_delta / system_delta) * num_cpus * 100.0
    return 0.0


@app.get("/api/stats/{container_id}")
async def container_stats(container_id: str):
    client = docker_client()
    container = _resolve_container(client, container_id)
    try:
        stats = container.stats(stream=False)
    except DockerException as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch stats: {exc}") from exc

    cpu_percent = _format_cpu_percent(stats)
    mem_stats = stats.get("memory_stats", {})
    mem_usage = mem_stats.get("usage", 0)
    mem_limit = mem_stats.get("limit", 0) or 1
    mem_percent = (mem_usage / mem_limit) * 100 if mem_limit else 0

    networks = stats.get("networks", {}) or {}
    rx_bytes = sum((v or {}).get("rx_bytes", 0) for v in networks.values())
    tx_bytes = sum((v or {}).get("tx_bytes", 0) for v in networks.values())

    blkio = stats.get("blkio_stats", {}) or {}
    read_bytes = 0
    write_bytes = 0
    for entry in blkio.get("io_service_bytes_recursive", []) or []:
        op = entry.get("op")
        if op == "Read":
            read_bytes += entry.get("value", 0)
        elif op == "Write":
            write_bytes += entry.get("value", 0)

    pids = stats.get("pids_stats", {}).get("current", 0)

    return {
        "cpuPercent": cpu_percent,
        "memoryUsage": mem_usage,
        "memoryLimit": mem_limit,
        "memoryPercent": mem_percent,
        "pids": pids,
        "netRx": rx_bytes,
        "netTx": tx_bytes,
        "blkRead": read_bytes,
        "blkWrite": write_bytes,
    }


def _resolve_container(client, container_id: str):
    try:
        return client.containers.get(container_id)
    except docker.errors.NotFound:
        matches = client.containers.list(all=True, filters={"id": container_id}) or []
        if not matches:
            matches = client.containers.list(all=True, filters={"name": container_id}) or []
        if not matches:
            raise HTTPException(status_code=404, detail="Container not found")
        return matches[0]


@app.get("/api/logs/{container_id}")
async def container_logs(
    container_id: str,
    tail: int = Query(200, ge=0, le=2000),
    since: Optional[int] = Query(None, ge=0),
):
    client = docker_client()
    container = _resolve_container(client, container_id)
    kwargs = {"tail": tail}
    if since is not None:
        kwargs["since"] = since
    logs = container.logs(**kwargs)
    if isinstance(logs, bytes):
        logs = logs.decode("utf-8", errors="ignore")
    now = datetime.now(tz=ZoneInfo("Asia/Kolkata"))
    lines = [
        {
            "timestamp": now.isoformat(),
            "line": line,
        }
        for line in logs.splitlines()
    ]
    return JSONResponse({"container": container.name, "lines": lines, "logs": logs})


@app.get("/api/logs/{container_id}/stream")
async def stream_logs(
    container_id: str,
    tail: int = Query(200, ge=0, le=2000),
    since: Optional[float] = Query(None, ge=0),
):
    client = docker_client()
    container = _resolve_container(client, container_id)

    def iter_logs():
        log_kwargs = {"stream": True, "follow": True, "tail": tail}
        if since is not None:
            log_kwargs["since"] = since
        try:
            for chunk in container.logs(**log_kwargs):
                if isinstance(chunk, bytes):
                    chunk = chunk.decode("utf-8", errors="ignore")
                chunk = chunk.replace("\r\n", "\n")
                for line in chunk.split("\n"):
                    if not line:
                        continue
                    payload = {
                        "timestamp": datetime.now(tz=ZoneInfo("Asia/Kolkata")).isoformat(),
                        "line": line,
                    }
                    yield f"data: {json.dumps(payload)}\n\n"
        except docker.errors.APIError as exc:  # pragma: no cover - surface to client
            yield f"event: error\ndata: {str(exc)}\n\n"
        except GeneratorExit:
            return

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(iter_logs(), media_type="text/event-stream", headers=headers)


@app.get("/api/compose")
async def compose_metadata():
    files = find_compose_files()
    return {"root": str(git_root()), "composeFiles": [str(p) for p in files], "services": parse_services_from_compose()}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/services/{container_id}/restart")
async def restart_service(container_id: str):
    client = docker_client()
    container = _resolve_container(client, container_id)
    try:
        container.restart()
    except DockerException as exc:
        raise HTTPException(status_code=500, detail=f"Failed to restart: {exc}") from exc
    return {"status": "restarted"}
