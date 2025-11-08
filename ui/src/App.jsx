import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

// const CORE_BASE = (import.meta.env.VITE_CORE_URL || '').trim();
const CORE_BASE = '';
const coreUrl = (path) => `${CORE_BASE}${path}`;

const createCorrelationId = () => crypto.randomUUID();

export default function App() {
  const [userId, setUserId] = useState('demo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [health, setHealth] = useState({ core: 'loading', producer: 'loading' });

  const headers = useMemo(() => ({ 'X-Correlation-Id': createCorrelationId() }), []);

  const fetchUser = useCallback(async () => {
    if (!userId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(coreUrl(`/api/user/${encodeURIComponent(userId.trim())}`), { headers });
      setData(response.data);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Unable to reach core service');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, headers]);

  useEffect(() => {
    const runHealthChecks = async () => {
      try {
        await axios.get(coreUrl('/actuator/health'), { headers });
        setHealth((h) => ({ ...h, core: 'up' }));
      } catch {
        setHealth((h) => ({ ...h, core: 'down' }));
      }
      try {
        await axios.get(coreUrl('/api/proxy/producer-health'), { headers });
        setHealth((h) => ({ ...h, producer: 'up' }));
      } catch {
        setHealth((h) => ({ ...h, producer: 'down' }));
      }
    };
    runHealthChecks();
  }, [headers]);

  return (
    <main>
      <section>
        <h1>Dev Portal</h1>
        <p>Chain: UI → Core → Producer</p>
        <div className="section">
          <label htmlFor="userId">User Id</label>
          <input id="userId" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="demo" />
        </div>
        <div className="section" style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={fetchUser} disabled={loading}>Fetch user</button>
          <button onClick={() => setData(null)} disabled={loading}>Clear</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {data && (
        <section className="section card">
          <h2>{data.name || data.id}</h2>
          <p>Email: {data.email}</p>
          <div className={`badge ${data.loggedIn ? 'live' : 'offline'}`}>
            {data.loggedIn ? 'Logged In ✅' : 'Logged Out ⚪️'}
          </div>
          <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>Correlation Id: {data.correlationId}</p>
        </section>
      )}

      <section className="section">
        <h3>Health</h3>
        <div className="health-grid">
          <div className="card">
            Core: <strong>{health.core}</strong>
          </div>
          <div className="card">
            Producer: <strong>{health.producer}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
