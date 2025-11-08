import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import { Service, fetchServices, serviceAction } from '../api/services';

interface ActionState {
  status: 'idle' | 'working' | 'error' | 'success';
  message?: string;
  correlationId?: string;
}

/**
 * ServicesDashboard fetches the Compose inventory and surfaces lifecycle
 * actions. The component keeps the UX defensive by:
 *
 * - Tracking the correlation id of the most recent failure so operators can
 *   immediately jump into backend logs.
 * - Optimistically refreshing after mutations to avoid stale service states.
 * - Normalizing status strings to avoid UI regressions when Compose returns
 *   unexpected casing ("running" vs "Running").
 */
function ServicesDashboard() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ActionState | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [actionState, setActionState] = useState<ActionState>({ status: 'idle' });

  async function loadServices() {
    setLoading(true);
    try {
      const data = await fetchServices();
      setServices(data);
      // Reset selection when the inventory changes to avoid acting on stale IDs.
      setSelected({});
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ status: 'error', message: String(err.detail ?? err.message), correlationId: err.correlationId });
      } else {
        setError({ status: 'error', message: (err as Error).message });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadServices();
  }, []);

  const selectedNames = useMemo(
    () => Object.entries(selected).filter(([, checked]) => checked).map(([name]) => name),
    [selected]
  );

  async function runAction(action: 'start' | 'stop' | 'restart', serviceName?: string) {
    const targets = serviceName ? [serviceName] : selectedNames;
    if (targets.length === 0) {
      setActionState({ status: 'error', message: 'Select at least one service.' });
      return;
    }

    setActionState({ status: 'working' });
    try {
      await serviceAction(action, targets);
      setActionState({ status: 'success', message: `${action} command accepted for ${targets.join(', ')}` });
      await loadServices();
    } catch (err) {
      if (err instanceof ApiError) {
        setActionState({
          status: 'error',
          message: typeof err.detail === 'string' ? err.detail : err.message,
          correlationId: err.correlationId,
        });
      } else {
        setActionState({ status: 'error', message: (err as Error).message });
      }
    }
  }

  return (
    <section className="card">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2>Compose Services</h2>
          <p style={{ opacity: 0.7 }}>
            Inspect live status, see published ports, and dispatch lifecycle actions against the FastAPI orchestrator.
          </p>
        </div>
        <div>
          <button onClick={() => runAction('start')} disabled={actionState.status === 'working'}>
            Start
          </button>
          <button onClick={() => runAction('stop')} disabled={actionState.status === 'working'}>
            Stop
          </button>
          <button onClick={() => runAction('restart')} disabled={actionState.status === 'working'}>
            Restart
          </button>
        </div>
      </header>

      {actionState.status === 'error' && (
        <p className="status-failed">
          {actionState.message}
          {actionState.correlationId && (
            <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.75 }}>
              Correlation ID: {actionState.correlationId}
            </span>
          )}
        </p>
      )}
      {actionState.status === 'success' && <p className="status-ok">{actionState.message}</p>}

      {loading && <p>Loading services…</p>}
      {!loading && error && (
        <p className="status-failed">
          Failed to load services: {error.message}
          {error.correlationId && <span> (Correlation ID: {error.correlationId})</span>}
        </p>
      )}

      {!loading && !error && (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Status</th>
              <th>Project</th>
              <th>Ports</th>
              <th>Tags</th>
              <th>Depends On</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.name}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected[service.name] ?? false}
                    onChange={(event) =>
                      setSelected((current) => ({ ...current, [service.name]: event.target.checked }))
                    }
                  />
                </td>
                <td>
                  <strong>{service.name}</strong>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                    Last change: {new Date(service.last_state_change).toLocaleString()}
                  </div>
                  <div style={{ marginTop: '0.4rem' }}>
                    {service.profiles.map((profile) => (
                      <span key={profile} className="badge">
                        {profile}
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => runAction('start', service.name)}
                      disabled={actionState.status === 'working'}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction('stop', service.name)}
                      disabled={actionState.status === 'working'}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Stop
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction('restart', service.name)}
                      disabled={actionState.status === 'working'}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Restart
                    </button>
                  </div>
                </td>
                <td>
                  <span className={service.status.toLowerCase() === 'running' ? 'status-ok' : 'status-failed'}>
                    {service.status}
                  </span>
                </td>
                <td>{service.compose_project}</td>
                <td>
                  {Object.entries(service.ports).map(([host, container]) => (
                    <div key={host}>
                      {host} → {container}
                    </div>
                  ))}
                </td>
                <td>
                  {service.tags.length > 0 ? service.tags.map((tag) => <span key={tag} className="badge">{tag}</span>) : '—'}
                </td>
                <td>
                  {service.depends_on.length > 0
                    ? service.depends_on.join(', ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default ServicesDashboard;
