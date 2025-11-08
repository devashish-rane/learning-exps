const serviceListEl = document.getElementById('service-list');
const logOutputEl = document.getElementById('log-output');
const titleEl = document.getElementById('selected-title');
const refreshButton = document.getElementById('refresh');
const statsCard = document.getElementById('stats-card');
const portsCard = document.getElementById('ports-card');
const networksCard = document.getElementById('networks-card');
const composeCard = document.getElementById('compose-card');
const topologyBar = document.getElementById('topology-bar');
const restartBtn = document.getElementById('restart-btn');
const toggleInsightsBtn = document.getElementById('toggle-insights');
const insightsContent = document.getElementById('insights-content');
const tailHint = document.getElementById('tail-hint');

let currentContainerId = null;
let currentDetails = null;
let statsTimer = null;
let statsHistory = { cpu: [], mem: [] };
let topologyData = null;
const LOG_TAIL_LIMIT = 200;
const STREAM_RETRY_MS = 2000;
const RECENT_HIGHLIGHT_COUNT = 5;
let logSource = null;
let streamRetryTimer = null;
let logLines = [];
const restartSinceMap = new Map();
let currentSinceHint = null;
let latestSnapshotRequest = 0;

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadServices() {
  serviceListEl.innerHTML = '<li>Loading...</li>';
  try {
    const services = await fetchJSON('/api/services');
    serviceListEl.innerHTML = '';
    services.forEach((svc) => {
      const li = document.createElement('li');
      const portPreview = (svc.ports || [])
        .filter((p) => p.hostPort)
        .map((p) => `<span class="badge">${p.hostPort}→${p.containerPort}</span>`)
        .join(' ');
      const metaLine = `${svc.project || 'compose'} · ${svc.status}`;
      li.innerHTML = `<strong>${svc.service || svc.name}</strong><br><small>${metaLine}</small>${portPreview ? `<div style="margin-top:4px">${portPreview}</div>` : ''}`;
      li.dataset.containerId = svc.id;
      li.dataset.serviceName = svc.service || svc.name;
      li.dataset.details = JSON.stringify(svc);
      li.addEventListener('click', () => selectService(li));
      serviceListEl.appendChild(li);
    });
    if (currentContainerId || currentDetails?.service) {
      const items = Array.from(document.querySelectorAll('#service-list li'));
      let active = items.find((li) => li.dataset.containerId === currentContainerId);
      if (!active && currentDetails?.service) {
        active = items.find((li) => li.dataset.serviceName === currentDetails.service);
        if (active) {
          currentContainerId = active.dataset.containerId;
        }
      }
      if (active) active.click();
      else {
        stopLogStream();
        logLines = [];
        logOutputEl.textContent = '(Select a container)';
        renderDetails(null);
        renderStats(null);
        stopStatsPolling();
        currentContainerId = null;
        currentDetails = null;
        currentSinceHint = null;
        setRestartButton(false);
      }
    }
  } catch (err) {
    serviceListEl.innerHTML = `<li class="error">${err.message}</li>`;
  }
}

async function selectService(el) {
  document.querySelectorAll('#service-list li').forEach((li) => li.classList.remove('active'));
  el.classList.add('active');
  stopLogStream();
  logLines = [];
  logOutputEl.textContent = 'Loading logs…';
  currentContainerId = el.dataset.containerId;
  currentDetails = JSON.parse(el.dataset.details || '{}');
  titleEl.textContent = `Logs: ${currentDetails.service || currentDetails.name}`;
  const serviceKey = currentDetails.service || currentDetails.name || currentContainerId;
  const restartOverride = restartSinceMap.get(serviceKey);
  const hasRestartOverride = typeof restartOverride === 'number';
  currentSinceHint = hasRestartOverride ? restartOverride : null;
  renderDetails(currentDetails);
  renderStats(null);
  resetStatsHistory();
  if (hasRestartOverride) {
    logOutputEl.textContent = 'Awaiting fresh logs…';
  } else {
    await fetchLogs(currentContainerId);
  }
  startStatsPolling();
  startLogStream(currentContainerId, currentSinceHint);
  setRestartButton(true);
}

function renderDetails(data) {
  if (!portsCard || !networksCard || !composeCard) return;
  if (!data) {
    portsCard.innerHTML = '<h4>Ports</h4><p><em>Awaiting selection...</em></p>';
    networksCard.innerHTML = '<h4>Networks</h4><p><em>Awaiting selection...</em></p>';
    composeCard.innerHTML = '<h4>Compose</h4><p><em>Awaiting selection...</em></p>';
    return;
  }
  const compose = data.compose || {};
  const depends = compose.depends_on || [];
  const profiles = compose.profiles || [];
  const ports = (data.ports || []).map((p) => {
    const hostIp = (!p.host || p.host === '0.0.0.0' || p.host === '::') ? 'localhost' : p.host;
    const label = `${p.host || 'container'}:${p.hostPort || ''} → ${p.containerPort}`;
    const link = p.hostPort ? `<a class="open-link" href="http://${hostIp}:${p.hostPort}" target="_blank" rel="noopener">Open</a>` : '';
    return `<div class="port-row"><code>${label}</code>${link}</div>`;
  }).join('') || '<p class="port-row"><em>No published ports</em></p>';

  const networks = (data.networks || []).map((n) => {
    const alias = (n.aliases || []).join(', ');
    return `<div class="network-row"><p><strong>${n.name}</strong></p>${alias ? `<p>Aliases: ${alias}</p>` : ''}</div>`;
  }).join('') || '<p><em>No network data</em></p>';

  const dependsList = depends.length ? depends.map((d) => `<span class="badge">${d}</span>`).join(' ') : '<em>None</em>';
  const profileList = profiles.length ? profiles.map((p) => `<span class="badge">${p}</span>`).join(' ') : '<em>None</em>';

  portsCard.innerHTML = `<h4>Ports</h4>${ports}`;
  networksCard.innerHTML = `<h4>Networks</h4>${networks}`;
  composeCard.innerHTML = `<h4>Compose</h4><p><strong>Depends on:</strong><br>${dependsList}</p><p><strong>Profiles:</strong><br>${profileList}</p>`;
}

function resetStatsHistory() {
  statsHistory = { cpu: [], mem: [] };
}

function startStatsPolling() {
  stopStatsPolling();
  if (!currentContainerId) return;
  fetchStats();
  statsTimer = setInterval(fetchStats, 2000);
}

function stopStatsPolling() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
}

async function fetchStats() {
  if (!currentContainerId) return;
  try {
    const data = await fetchJSON(`/api/stats/${currentContainerId}`);
    if (!data) return;
    statsHistory.cpu.push(Math.max(0, data.cpuPercent || 0));
    statsHistory.mem.push(Math.max(0, data.memoryPercent || 0));
    statsHistory.cpu = statsHistory.cpu.slice(-30);
    statsHistory.mem = statsHistory.mem.slice(-30);
    renderStats(data);
  } catch (err) {
    renderStats({ error: err.message });
  }
}

function renderStats(data) {
  if (!statsCard) return;
  if (!data || data.error) {
    statsCard.innerHTML = data && data.error ? `<p>Error: ${data.error}</p>` : '<p>Select a service to view CPU / memory stats.</p>';
    return;
  }
  const cpu = data.cpuPercent || 0;
  const memPercent = data.memoryPercent || 0;
  const memUsage = formatBytes(data.memoryUsage || 0);
  const memLimit = formatBytes(data.memoryLimit || 0);
  const pids = data.pids || 0;
  const net = `${formatBytes(data.netRx || 0)} ↓ / ${formatBytes(data.netTx || 0)} ↑`;

  statsCard.innerHTML = `
    <h4>Memory</h4>
    <p>${memUsage} / ${memLimit} (${memPercent.toFixed(1)}%)</p>
    <div class="gauge"><div style="width:${Math.min(100, memPercent).toFixed(1)}%"></div></div>
    ${renderSparkline(statsHistory.mem, 100)}
    <p style="margin-top:0.4rem">PIDs: ${pids} · Net: ${net}</p>
  `;
}

function renderSparkline(values, maxValue) {
  if (!values.length || !maxValue) return '';
  const width = 120;
  const height = 28;
  const step = values.length === 1 ? width : width / (values.length - 1);
  const points = values.map((v, i) => {
    const clamped = Math.min(Math.max(v, 0), maxValue);
    const y = height - (clamped / maxValue) * height;
    return `${i * step},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline class="baseline" points="0 ${height} ${width} ${height}" /><polyline points="${points}" /></svg>`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

async function loadTopology() {
  if (!topologyBar) return;
  try {
    topologyData = await fetchJSON('/api/topology');
    renderTopology();
  } catch (err) {
    topologyBar.innerHTML = `<p>Error loading topology: ${err.message}</p>`;
  }
}

function renderTopology() {
  if (!topologyBar) return;
  if (!topologyData) {
    topologyBar.innerHTML = '<p>Loading topology…</p>';
    return;
  }
  const chips = [];
  Object.entries(topologyData.networks || {}).forEach(([net, services]) => {
    chips.push(`<span class="topology-chip">${net}: ${services.join(', ') || '—'}</span>`);
  });
  Object.entries(topologyData.services || {}).forEach(([svc, meta]) => {
    (meta.depends_on || []).forEach((dep) => {
      chips.push(`<span class="topology-chip">${svc} → ${dep}</span>`);
    });
  });
  topologyBar.innerHTML = chips.length ? chips.join('') : '<p>No topology data</p>';
}

refreshButton.addEventListener('click', async () => {
  await loadServices();
  loadTopology();
  if (currentContainerId) {
    await fetchLogs(currentContainerId);
    restartLogStream();
  }
});

if (restartBtn) {
  restartBtn.addEventListener('click', restartServiceAction);
}

window.addEventListener('beforeunload', () => {
  if (statsTimer) clearInterval(statsTimer);
  stopLogStream();
});

loadServices();
loadTopology();
setRestartButton(false);
logOutputEl.style.whiteSpace = 'pre-wrap';
if (tailHint) {
  tailHint.textContent = `Live tail · last ${LOG_TAIL_LIMIT} lines`;
}

if (toggleInsightsBtn && insightsContent) {
  const updateInsightsToggleLabel = () => {
    const collapsed = insightsContent.classList.contains('collapsed');
    toggleInsightsBtn.textContent = collapsed ? 'Show' : 'Hide';
  };
  updateInsightsToggleLabel();
  toggleInsightsBtn.addEventListener('click', () => {
    insightsContent.classList.toggle('collapsed');
    updateInsightsToggleLabel();
  });
}

async function fetchLogs(id, silent = false) {
  const requestId = ++latestSnapshotRequest;
  if (!silent) logOutputEl.textContent = 'Loading logs...';
  try {
    const params = new URLSearchParams({ tail: LOG_TAIL_LIMIT.toString() });
    const data = await fetchJSON(`/api/logs/${id}?${params.toString()}`);
    if (id !== currentContainerId || requestId !== latestSnapshotRequest) {
      return false;
    }
    const lines = data.lines || [];
    logLines = lines.map((entry) => ({
      ts: entry.timestamp || new Date().toISOString(),
      text: entry.line || '',
    }));
    trimLogLines();
    renderLogLines();
    if (!logLines.length) {
      logOutputEl.textContent = '(No logs)';
    }
    currentSinceHint = Math.max(0, Math.floor(Date.now() / 1000) - 1);
    return true;
  } catch (err) {
    if (id === currentContainerId && requestId === latestSnapshotRequest) {
      logOutputEl.textContent = `Error fetching logs: ${err.message}`;
    }
    return false;
  }
}

function setRestartButton(enabled) {
  if (!restartBtn) return;
  restartBtn.disabled = !enabled;
  restartBtn.textContent = enabled ? 'Restart Service' : 'Restart Service';
}

async function restartServiceAction() {
  if (!currentContainerId || !restartBtn) return;
  restartBtn.disabled = true;
  restartBtn.textContent = 'Restarting…';
  stopLogStream();
  logLines = [];
  logOutputEl.textContent = 'Service restarting… waiting for fresh logs';
  const serviceKey = currentDetails?.service || currentDetails?.name || currentContainerId;
  const restartEpoch = Math.max(0, Math.floor(Date.now() / 1000) - 1);
  if (serviceKey) {
    restartSinceMap.set(serviceKey, restartEpoch);
  }
  currentSinceHint = restartEpoch;
  try {
    await fetch(`/api/services/${currentContainerId}/restart`, { method: 'POST' });
    await loadServices();
  } catch (err) {
    logOutputEl.textContent = `Restart failed: ${err.message}`;
    logLines = [];
    if (serviceKey) restartSinceMap.delete(serviceKey);
    currentSinceHint = null;
    currentContainerId = null;
  } finally {
    restartBtn.textContent = 'Restart Service';
    restartBtn.disabled = !currentContainerId;
  }
}

function startLogStream(id, since = null) {
  stopLogStream();
  if (!id || typeof EventSource === 'undefined') return;
  const params = new URLSearchParams();
  const shouldTail = !logLines.length && typeof since !== 'number';
  params.set('tail', (shouldTail ? LOG_TAIL_LIMIT : 0).toString());
  if (typeof since === 'number') params.set('since', since.toString());
  logSource = new EventSource(`/api/logs/${id}/stream?${params.toString()}`);
  logSource.onmessage = (event) => {
    if (!event.data) return;
    appendLogLines(event.data);
  };
  logSource.onerror = () => {
    appendSystemLine('[log stream interrupted, retrying…]');
    stopLogStream();
    scheduleStreamRetry();
  };
}

function scheduleStreamRetry() {
  if (streamRetryTimer || !currentContainerId) return;
  streamRetryTimer = setTimeout(() => {
    streamRetryTimer = null;
    if (!currentContainerId) return;
    startLogStream(currentContainerId, currentSinceHint);
  }, STREAM_RETRY_MS);
}

function stopLogStream() {
  if (logSource) {
    logSource.close();
    logSource = null;
  }
  if (streamRetryTimer) {
    clearTimeout(streamRetryTimer);
    streamRetryTimer = null;
  }
}

function restartLogStream() {
  if (!currentContainerId) return;
  startLogStream(currentContainerId, currentSinceHint);
}

function appendLogLines(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    return;
  }
  if (!parsed || typeof parsed.line !== 'string') return;
  logLines.push({
    ts: parsed.timestamp || new Date().toISOString(),
    text: parsed.line,
  });
  trimLogLines();
  renderLogLines();
  currentSinceHint = Math.max(0, Math.floor(Date.now() / 1000) - 1);
  const key = currentDetails?.service || currentDetails?.name || currentContainerId;
  if (key) restartSinceMap.delete(key);
}

function appendSystemLine(message) {
  logLines.push({ ts: new Date().toISOString(), text: message, system: true });
  trimLogLines();
  renderLogLines();
}

function trimLogLines() {
  const limit = LOG_TAIL_LIMIT;
  if (logLines.length > limit) {
    logLines = logLines.slice(-limit);
  }
}

const istFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatTimestamp(ts) {
  try {
    const date = ts ? new Date(ts) : new Date();
    return istFormatter.format(date);
  } catch (err) {
    return ts || '';
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLogLines() {
  if (!logLines.length) {
    logOutputEl.innerHTML = '<div class="log-line empty">(No logs)</div>';
    return;
  }
  const recentStart = Math.max(0, logLines.length - RECENT_HIGHLIGHT_COUNT);
  const html = logLines
    .map((entry, index) => {
      const classes = ['log-line'];
      if (index >= recentStart) classes.push('recent');
      if (entry.system) classes.push('system');
      return `
        <div class="${classes.join(' ')}">
          <span class="log-ts">${escapeHtml(formatTimestamp(entry.ts))}</span>
          <span class="log-text">${escapeHtml(entry.text)}</span>
        </div>`;
    })
    .join('');
  logOutputEl.innerHTML = html;
  logOutputEl.scrollTop = logOutputEl.scrollHeight;
}
