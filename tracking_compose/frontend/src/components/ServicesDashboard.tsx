import React, {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Minimal shape returned by the services endpoint. The dashboard intentionally keeps the interface
 * slim to decouple rendering from backend changes while still exposing enough data for operators.
 */
export interface ServiceRow {
  name: string;
  status: string;
  compose_project?: string;
  last_state_change?: string;
}

type ServiceAction = "start" | "stop" | "restart";

type SelectedMap = Record<string, boolean>;

/**
 * Render a checkable dashboard with bulk orchestration affordances for Compose services.
 *
 * The original implementation lived exclusively on the row-level checkboxes. This rewrite keeps the
 * previous behaviour intact while layering a header-level select-all checkbox whose visual state is
 * derived from the existing `selected` map. Keeping the toggle entirely state-driven avoids the
 * brittle imperative bookkeeping that tends to break during refactors or rendering glitches.
 */
const ServicesDashboard: React.FC = () => {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<ServiceAction | null>(null);
  const [selected, setSelected] = useState<SelectedMap>({});

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const selectableNames = useMemo(() => services.map((service) => service.name), [services]);
  const selectedNames = useMemo(
    () => selectableNames.filter((name) => Boolean(selected[name])),
    [selectableNames, selected]
  );

  const selectedCount = selectedNames.length;
  const selectableCount = selectableNames.length;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  const isIndeterminate = selectedCount > 0 && !allSelected;

  /**
   * React does not manage the `indeterminate` property on checkboxes, therefore we adjust it manually
   * whenever the aggregate state changes. Forgetting to do so leads to stale UI once rows disappear
   * after refreshes – a production bug that is notoriously confusing during incident response.
   */
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  /**
   * When a service disappears (e.g. rename, compose file edit) we prune it from the selection map so
   * the header checkbox visual state stays accurate and we do not attempt actions against ghosts.
   */
  useEffect(() => {
    setSelected((previous) => {
      const next: SelectedMap = {};
      for (const name of selectableNames) {
        if (previous[name]) {
          next[name] = true;
        }
      }
      const previousKeys = Object.keys(previous).filter((name) => previous[name]);
      const nextKeys = Object.keys(next);
      if (previousKeys.length === nextKeys.length && previousKeys.every((name) => next[name])) {
        return previous;
      }
      return next;
    });
  }, [selectableNames]);

  const refreshServices = useCallback(async () => {
    // A dedicated loader function keeps the happy-path terse while making it trivial to audit what
    // happens when fetch fails in production – every exit path updates both the spinner and error UI.
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/services");
      if (!response.ok) {
        throw new Error(`Unable to load services (HTTP ${response.status}).`);
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("Received unexpected payload from services API.");
      }

      const normalized = payload.filter((item): item is ServiceRow => {
        return Boolean(item && typeof item === "object" && "name" in item && "status" in item);
      });
      setServices(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error loading services.";
      setLoadError(message);
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshServices();
  }, [refreshServices]);

  const toggleService = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = event.target;
    setSelected((previous) => ({ ...previous, [name]: checked }));
  }, []);

  const toggleAll = useCallback(() => {
    // We compute the new state from the callback argument to avoid relying on any potentially stale
    // closure state. React batches updates aggressively in concurrent mode and without this guard the
    // select-all checkbox can desynchronise during rapid refresh cycles.
    setSelected((previous) => {
      const previouslySelected = selectableNames.filter((name) => Boolean(previous[name]));
      const shouldSelectAll = previouslySelected.length !== selectableNames.length;

      if (!shouldSelectAll) {
        return {};
      }

      const next: SelectedMap = {};
      for (const name of selectableNames) {
        next[name] = true;
      }
      return next;
    });
  }, [selectableNames]);

  const servicesForAction = useCallback(
    (target?: string): string[] => {
      if (target) {
        return [target];
      }
      // Bulk commands reuse the memoised selection list so we always operate on the latest snapshot.
      return selectedNames.length > 0 ? selectedNames : [];
    },
    [selectedNames]
  );

  /**
   * Fire orchestration commands against the compose backend.
   *
   * We intentionally reset the bulk selection only after the POST call succeeds so retries after
   * transient failures (Docker daemon restarts, compose contention, networking blips) remain a single
   * click. Row-level actions prune just the affected service to keep the select-all checkbox honest.
   */
  const runAction = useCallback(
    async (action: ServiceAction, target?: string) => {
      const servicesToAffect = servicesForAction(target);
      if (servicesToAffect.length === 0) {
        setActionError("Select at least one service before running a bulk action.");
        return;
      }

      setActionError(null);
      setBusyAction(action);

      try {
        const response = await fetch(`/api/services/actions/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ services: servicesToAffect }),
        });

        if (!response.ok) {
          let detail: string | null = null;
          try {
            const body = await response.json();
            if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
              detail = body.detail;
            }
          } catch (parseError) {
            // JSON-less responses happen when proxies emit HTML error pages. Logging aids prod triage.
            if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
              console.debug("Unable to parse action error response", parseError);
            }
          }
          const fallback = `Failed to ${action} ${servicesToAffect.length > 1 ? "services" : "service"}.`;
          throw new Error(detail ?? fallback);
        }

        // We always refresh to reflect orchestrator state even if Compose finishes asynchronously.
        await refreshServices();

        // On successful bulk actions we clear the full selection so the header checkbox resets.
        setSelected((previous) => {
          if (target) {
            const next = { ...previous };
            delete next[target];
            return next;
          }
          return {};
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error while running action.";
        setActionError(message);
        // Intentionally *not* clearing selections so operators can retry the same set immediately.
      } finally {
        setBusyAction(null);
      }
    },
    [refreshServices, servicesForAction]
  );

  return (
    <div className="services-dashboard">
      <header>
        <h1>Services</h1>
        <p className="services-dashboard__hint">
          Manage docker-compose orchestrated services. Use the header checkbox for bulk targeting.
        </p>
      </header>

      {loadError ? (
        <div role="alert" className="services-dashboard__error">
          {loadError}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="services-dashboard__error">
          {actionError}
        </div>
      ) : null}

      <section className="services-dashboard__actions" aria-live="polite">
        <button type="button" onClick={() => void runAction("start")} disabled={busyAction !== null || selectedCount === 0}>
          Start Selected
        </button>
        <button type="button" onClick={() => void runAction("stop")} disabled={busyAction !== null || selectedCount === 0}>
          Stop Selected
        </button>
        <button type="button" onClick={() => void runAction("restart")} disabled={busyAction !== null || selectedCount === 0}>
          Restart Selected
        </button>
        <span className="services-dashboard__selection" aria-live="polite">
          {selectedCount} selected
        </span>
      </section>

      <table className="services-dashboard__table">
        <thead>
          <tr>
            <th scope="col">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-checked={isIndeterminate ? "mixed" : allSelected ? "true" : "false"}
                aria-label={allSelected ? "Deselect all services" : "Select all services"}
              />
            </th>
            <th scope="col">Service</th>
            <th scope="col">Status</th>
            <th scope="col">Last state change</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5}>Loading services…</td>
            </tr>
          ) : services.length === 0 ? (
            <tr>
              <td colSpan={5}>No services discovered.</td>
            </tr>
          ) : (
            services.map((service) => {
              const isChecked = Boolean(selected[service.name]);
              return (
                <tr key={service.name}>
                  <td>
                    <input
                      type="checkbox"
                      name={service.name}
                      checked={isChecked}
                      onChange={toggleService}
                      aria-label={`Select ${service.name}`}
                    />
                  </td>
                  <td>
                    <strong>{service.name}</strong>
                    {service.compose_project ? (
                      <div className="services-dashboard__meta">{service.compose_project}</div>
                    ) : null}
                  </td>
                  <td>{service.status}</td>
                  <td>{service.last_state_change ?? "—"}</td>
                  <td>
                    <div className="services-dashboard__row-actions">
                      <button
                        type="button"
                        onClick={() => void runAction("start", service.name)}
                        disabled={busyAction !== null}
                      >
                        Start
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction("stop", service.name)}
                        disabled={busyAction !== null}
                      >
                        Stop
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction("restart", service.name)}
                        disabled={busyAction !== null}
                      >
                        Restart
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ServicesDashboard;
