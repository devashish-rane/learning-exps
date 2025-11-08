import { NavLink, Route, Routes } from 'react-router-dom';
import ServicesDashboard from './components/ServicesDashboard';
import HealthPanel from './components/HealthPanel';
import MetricsView from './components/MetricsView';
import TraceExplorer from './components/TraceExplorer';

function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Dockhand</h1>
        <p style={{ opacity: 0.75, marginBottom: '1.5rem' }}>
          Compose orchestration cockpit wired into FastAPI.
        </p>
        <nav>
          <NavLink to="/" end>
            Services
          </NavLink>
          <NavLink to="/health">Health</NavLink>
          <NavLink to="/metrics">HTTP Metrics</NavLink>
          <NavLink to="/traces">Trace Explorer</NavLink>
        </nav>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<ServicesDashboard />} />
          <Route path="/health" element={<HealthPanel />} />
          <Route path="/metrics" element={<MetricsView />} />
          <Route path="/traces" element={<TraceExplorer />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
