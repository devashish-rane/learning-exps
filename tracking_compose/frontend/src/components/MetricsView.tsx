import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import { HttpMetrics, fetchHttpMetrics } from '../api/services';

interface MetricsState {
  data: HttpMetrics | null;
  loading: boolean;
  error?: { message: string; correlationId?: string };
  selectedService?: string;
}

function MetricsView() {
  const [state, setState] = useState<MetricsState>({ data: null, loading: true });

  async function load() {
    setState((current) => ({ ...current, loading: true }));
    try {
      const metrics = await fetchHttpMetrics();
      const firstService = Object.keys(metrics)[0];
      setState((current) => ({
        data: metrics,
        loading: false,
        selectedService: current.selectedService ?? firstService,
      }));
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
  }, []);

  const services = useMemo(() => (state.data ? Object.keys(state.data) : []), [state.data]);
  const rows = useMemo(() => {
    if (!state.data || !state.selectedService) {
      return [];
    }
    return state.data[state.selectedService] ?? [];
  }, [state.data, state.selectedService]);

  return (
    <section className="card">
      <h2>HTTP Metrics</h2>
      <p style={{ opacity: 0.7 }}>
        Percentiles come from the backend aggregator which already enforces sensible bounds on endpoint volume. Nulls
        indicate the underlying service has not reported the datapoint yet (common when Actuator metrics lag).
      </p>

      {state.loading && <p>Loading metrics…</p>}
      {state.error && (
        <p className="status-failed">
          Failed to load metrics: {state.error.message}
          {state.error.correlationId && <span> (Correlation ID: {state.error.correlationId})</span>}
        </p>
      )}

      {state.data && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="service-select" style={{ marginRight: '0.5rem' }}>
              Service
            </label>
            <select
              id="service-select"
              value={state.selectedService}
              onChange={(event) => setState((current) => ({ ...current, selectedService: event.target.value }))}
            >
              {services.map((service) => (
                <option key={service} value={service}>
                  {service}
                </option>
              ))}
            </select>
          </div>
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Method</th>
                <th>P50 (ms)</th>
                <th>P90 (ms)</th>
                <th>P99 (ms)</th>
                <th>Error Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.method}-${row.endpoint}`}>
                  <td>{row.endpoint}</td>
                  <td>{row.method}</td>
                  <td>{row.p50_ms ?? '—'}</td>
                  <td>{row.p90_ms ?? '—'}</td>
                  <td>{row.p99_ms ?? '—'}</td>
                  <td>{row.error_rate != null ? `${(row.error_rate * 100).toFixed(2)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export default MetricsView;
