import { FormEvent, useState } from 'react';
import { ApiError } from '../api/client';
import { TraceResponse, fetchTrace } from '../api/services';

interface TraceState {
  trace: TraceResponse | null;
  loading: boolean;
  error?: { message: string; correlationId?: string };
}

function TraceExplorer() {
  const [traceId, setTraceId] = useState('');
  const [state, setState] = useState<TraceState>({ trace: null, loading: false });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!traceId.trim()) {
      setState({ trace: null, loading: false, error: { message: 'Enter a trace id to search.' } });
      return;
    }

    setState({ trace: null, loading: true });
    try {
      const trace = await fetchTrace(traceId.trim());
      setState({ trace, loading: false });
    } catch (error) {
      if (error instanceof ApiError) {
        setState({
          trace: null,
          loading: false,
          error: { message: String(error.detail ?? error.message), correlationId: error.correlationId },
        });
      } else {
        setState({ trace: null, loading: false, error: { message: (error as Error).message } });
      }
    }
  }

  return (
    <section className="card">
      <h2>Trace Explorer</h2>
      <p style={{ opacity: 0.7 }}>
        FastAPI proxies the Jaeger/OTel backends and falls back to log correlation when tracing is disabled. We surface
        both cases by rendering spans if present or log lines when the backend had to walk container logs.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="trace-id-1234"
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
          style={{ flex: '1 1 auto' }}
        />
        <button type="submit" disabled={state.loading}>
          Fetch Trace
        </button>
      </form>

      {state.loading && <p>Fetching trace…</p>}
      {state.error && (
        <p className="status-failed">
          Failed to fetch trace: {state.error.message}
          {state.error.correlationId && <span> (Correlation ID: {state.error.correlationId})</span>}
        </p>
      )}

      {state.trace && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {'spans' in state.trace && Array.isArray(state.trace.spans) && state.trace.spans.length > 0 && (
            <div>
              <h3>Spans</h3>
              <pre
                style={{
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  padding: '1rem',
                  borderRadius: '8px',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(state.trace.spans, null, 2)}
              </pre>
            </div>
          )}
          {'lines' in state.trace && Array.isArray(state.trace.lines) && state.trace.lines.length > 0 && (
            <div>
              <h3>Log Correlation</h3>
              <pre
                style={{
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  padding: '1rem',
                  borderRadius: '8px',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {state.trace.lines.join('\n')}
              </pre>
            </div>
          )}
          {state.trace.trace_id && (
            <p style={{ opacity: 0.7 }}>Trace ID: {state.trace.trace_id}</p>
          )}
        </div>
      )}
    </section>
  );
}

export default TraceExplorer;
