import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { HealthSnapshot, fetchHealth } from '../api/services';

interface HealthState {
  data: HealthSnapshot | null;
  loading: boolean;
  error?: { message: string; correlationId?: string };
}

const POLL_INTERVAL_MS = 15000; // Keep health dashboards fresh without overwhelming the backend.

function HealthPanel() {
  const [state, setState] = useState<HealthState>({ data: null, loading: true });

  async function load() {
    setState((current) => ({ ...current, loading: true }));
    try {
      const snapshot = await fetchHealth();
      setState({ data: snapshot, loading: false });
    } catch (error) {
      if (error instanceof ApiError) {
        setState({
          data: null,
          loading: false,
          error: { message: String(error.detail ?? error.message), correlationId: error.correlationId },
        });
      } else {
        setState({ data: null, loading: false, error: { message: (error as Error).message } });
      }
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="card">
      <h2>Health Snapshots</h2>
      <p style={{ opacity: 0.7 }}>
        The monitor polls service health endpoints asynchronously. Errors capture correlation ids so we can align UI
        failures with backend diagnostics.
      </p>

      {state.loading && <p>Polling health endpoints…</p>}
      {state.error && (
        <p className="status-failed">
          Failed to fetch health: {state.error.message}
          {state.error.correlationId && <span> (Correlation ID: {state.error.correlationId})</span>}
        </p>
      )}

      {state.data && (
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th>Latency (ms)</th>
              <th>Code</th>
              <th>URL</th>
              <th>Captured</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(state.data).map((snapshot) => (
              <tr key={snapshot.service_name}>
                <td>{snapshot.service_name}</td>
                <td className={snapshot.healthy ? 'status-ok' : 'status-failed'}>
                  {snapshot.healthy ? 'Healthy' : 'Unhealthy'}
                </td>
                <td>{snapshot.latency_ms ?? '—'}</td>
                <td>{snapshot.status_code ?? '—'}</td>
                <td>{snapshot.url ?? 'n/a'}</td>
                <td>{new Date(snapshot.taken_at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default HealthPanel;
