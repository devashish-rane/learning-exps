const traceListEl = document.getElementById('trace-list');
const refreshTracesBtn = document.getElementById('traces-refresh');

async function fetchTraces() {
  if (!traceListEl) return;
  traceListEl.innerHTML = '<p class="trace-status">Loading traces…</p>';
  try {
    const res = await fetch('/api/traces');
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const data = await res.json();
    renderTraces(data.requests || []);
  } catch (err) {
    traceListEl.innerHTML = `<p class="trace-status error">${err.message}</p>`;
  }
}

function renderTraces(traces) {
  if (!traces.length) {
    traceListEl.innerHTML = '<p class="trace-status">No TRACE_SUMMARY entries yet. Exercise an endpoint and refresh.</p>';
    return;
  }
  const cards = traces.map((trace, idx) => {
    const traceId = trace.traceId || '';
    const flow = buildFlowFromTrace(trace);
    return `
      <article class="trace-card">
        ${flow ? `<div class="flow-bar">${flow}</div>` : ''}
        <div class="combined-logs" id="combined-${traceId}">
          <p class="trace-status">Loading…</p>
        </div>
      </article>`;
  }).join('');
  traceListEl.innerHTML = cards;
  // Auto-load combined logs for each trace card
  (traces || []).forEach((t) => {
    const tid = t.traceId || '';
    const el = document.getElementById(`combined-${tid}`);
    if (tid && el) renderCombinedLogs(tid, el);
  });
}

if (refreshTracesBtn) {
  refreshTracesBtn.addEventListener('click', fetchTraces);
}

fetchTraces();

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function renderCombinedLogs(traceId, container) {
  container.innerHTML = '<p class="trace-status">Loading…</p>';
  try {
    const res = await fetch(`/api/traces/${traceId}/logs?tail=1200`);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const data = await res.json();
    const lines = (data.lines || []).map((e) => {
      const ts = e.ts ? formatFullTs(e.ts) : '';
      const levelClass = deriveLevelClass(e.line || '');
      const statusClass = deriveStatusClass(e.line || '');
      const svcStyle = `style="color:${serviceColor(e.service || '')}"`;
      const stripped = stripAnsi(e.line || '');
      const jsonBlock = formatMaybeJson(stripped);
      const content = jsonBlock || `<span class="combined-text">${highlightText(stripped)}</span>`;
      return `<div class="combined-line ${levelClass} ${statusClass}"><small class="combined-ts">${escapeHtml(ts)}</small> <span class="combined-svc" ${svcStyle}>[${escapeHtml(e.service || '')}]</span> ${content}</div>`;
    }).join('');
    container.innerHTML = lines || '<p class="trace-status">No matching log lines found.</p>';
  } catch (err) {
    container.innerHTML = `<p class=\"trace-status error\">${escapeHtml(err.message)}</p>`;
  }
}

function deriveLevelClass(text) {
  const t = text || '';
  if (/\b(ERROR|Exception)\b/i.test(t)) return 'lvl-error';
  if (/\bWARN(ING)?\b/i.test(t)) return 'lvl-warn';
  return 'lvl-info';
}

function deriveStatusClass(text) {
  const m = /(respond\s+)?(status\s*)?(\b[1-5]\d\d\b)/i.exec(text || '');
  if (!m) return '';
  const code = parseInt(m[3], 10);
  if (code >= 500) return 'http-error';
  if (code >= 400) return 'http-warn';
  if (code >= 200) return 'http-ok';
  return '';
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

function serviceColor(name) {
  if (!name) return '#0ea5e9';
  const h = hashCode(name) % 360;
  return `hsl(${h}, 70%, 45%)`;
}

function highlightText(text) {
  let s = escapeHtml(text || '');
  // Methods
  s = s.replace(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g, '<span class="tok-method">$1</span>');
  // Paths (simple)
  s = s.replace(/\s(\/[\w\-._~\/?#\[\]@!$&'()*+,;=%]+)\b/g, ' <span class="tok-path">$1</span>');
  // Status codes
  s = s.replace(/\b(\d{3})\b/g, '<span class="tok-status">$1</span>');
  // Durations (ms)
  s = s.replace(/\b(\d+\s?ms)\b/g, '<span class="tok-duration">$1</span>');
  // Arrows
  s = s.replace(/\s-\>\s/g, ' <span class="tok-arrow">→</span> ');
  // respond keyword
  s = s.replace(/\brespond\b/gi, '<span class="tok-respond">respond</span>');
  // HTTP_* tokens
  s = s.replace(/\bHTTP_[A-Z_]+\b/g, '<span class="tok-http">$&</span>');
  // TRACE id token
  s = s.replace(/\bTRACE\s+[0-9a-f]{6,}\b/gi, '<span class="tok-trace">$&</span>');
  return s;
}

function stripAnsi(str) {
  try {
    return (str || '').replace(/\u001b\[[0-9;]*m/g, '');
  } catch (e) {
    return str || '';
  }
}

function formatFullTs(value) {
  try {
    // Prefer ISO 8601 in UTC for a full timestamp
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return String(value);
  } catch {
    return String(value);
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatMaybeJson(text) {
  const raw = (text || '').trim();
  // Case 1: Whole line is JSON
  if (raw.startsWith('{') || raw.startsWith('[')) {
    const obj = tryParseJson(raw);
    if (!obj) return null;
    if (obj && typeof obj === 'object' && typeof obj.message === 'string') {
      const nested = tryParseJson(obj.message);
      if (nested) obj.message = nested;
    }
    const pretty = JSON.stringify(obj, null, 2);
    return `<pre class=\"json-block\">${escapeHtml(pretty)}</pre>`;
  }
  // Case 2: Trailing JSON payload in the line (find first '{' and last '}' and try to parse substring)
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const head = raw.slice(0, first).trimEnd();
    const body = raw.slice(first, last + 1);
    const obj = tryParseJson(body);
    if (obj) {
      const pretty = JSON.stringify(obj, null, 2);
      const headHtml = head ? `<span class=\"combined-text\">${highlightText(head)}</span>` : '';
      return `${headHtml}${head ? '<br>' : ''}<pre class=\"json-block\">${escapeHtml(pretty)}</pre>`;
    }
  }
  return null;
}

function buildFlowFromTrace(trace) {
  try {
    const entries = Array.isArray(trace.entries) ? trace.entries : [];
    if (!entries.length) return '';
    const seen = new Set();
    const orderedParts = [];
    entries.forEach((e) => {
      if (!e || !e.timeline) return;
      const tl = String(e.timeline);
      const parts = tl
        .replace(/^\s*\[|\]\s*$/g, '')
        .split('->')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !/^TRACE\b/i.test(s))
        .filter((s) => !/^\d{4}-\d{2}-\d{2}T/i.test(s));
      parts.forEach((p) => {
        if (!seen.has(p)) {
          seen.add(p);
          orderedParts.push(p);
        }
      });
    });
    if (!orderedParts.length) return '';
    const chips = [];
    orderedParts.forEach((p, i) => {
      let svc = '';
      let body = p;
      const colon = p.indexOf(':');
      if (colon > -1) {
        svc = p.slice(0, colon).trim();
        body = p.slice(colon + 1).trim();
      }
      const style = svc ? ` style=\"border-color:${serviceColor(svc)};color:${serviceColor(svc)}\"` : '';
      chips.push(`<span class=\"flow-chip\"${style}>${svc ? `<span class=\"svc\">${escapeHtml(svc)}</span>` : ''}${escapeHtml(body)}</span>`);
      if (i < orderedParts.length - 1) chips.push('<span class="flow-arrow">→</span>');
    });
    return chips.join('');
  } catch {
    return '';
  }
}
