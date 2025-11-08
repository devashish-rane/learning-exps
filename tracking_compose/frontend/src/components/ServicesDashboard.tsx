import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Representation of a service as returned by the tracking compose backend.
 *
 * The dashboard intentionally keeps the interface narrow – only fields needed to display the
 * inventory and drive lifecycle commands are modeled. Additional attributes can be layered in as
 * the UI evolves without rewriting the selection logic introduced in this change.
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
 * Derive an error message from a failed fetch response or thrown error.
 *
 * Documenting the helper makes debugging easier when production issues arise. Developers can add
 * trace IDs or server supplied diagnostic codes without touching the call sites.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unexpected error while contacting the orchestration API.";
}

/**
 * ServicesDashboard renders the service inventory alongside lifecycle actions.
 *
 * The component now exposes a header-level checkbox that controls the entire selection map. The
 * indeterminate state is driven by the selection map so operators can understand whether only a
 * subset is currently staged for bulk actions.
 */
const ServicesDashboard: React.FC = () => {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedMap>({});
  const [busyAction, setBusyAction] = useState<ServiceAction | null>(null);

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );

  const selectableNames = useMemo(() => services.map((service) => service.name), [services]);

  const allSelected = useMemo(() => {
    if (services.length === 0) {
      return false;
    }
    return selectableNames.every((name) => selected[name]);
  }, [selectableNames, selected, services.length]);

  const isIndeterminate = useMemo(
    () => selectedCount > 0 && !allSelected,
    [allSelected, selectedCount]
  );

  /**
   * Keep the header checkbox's native indeterminate property in sync with React state.
   *
   * React does not manage the `indeterminate` flag, so we toggle it manually any time the
   * derived boolean changes. This keeps the UI accessible while avoiding races with re-renders
   * should the fetch refresh the service list mid-interaction.
   */
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  /**
   * Filter out selections that no longer exist after a refresh.
   *
   * Without this guard the bulk checkbox could remain indeterminate if a service disappears from
   * the backend response, leaving operators confused about hidden selections.
   */
  useEffect(() => {
    setSelected((previous) => {
      const next: SelectedMap = {};
      selectableNames.forEach((name) => {
        if (previous[name]) {
          next[name] = true;
        }
      });
      return next;
    });
  }, [selectableNames]);

  const refreshServices = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/services");
      if (!response.ok) {
        throw new Error(`Unable to load services (HTTP ${response.status}).`);
      }
      const data: ServiceRow[] = await response.json();
      setServices(data);
    } catch (error) {
      setLoadError(extractErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshServices();
  }, [refreshServices]);

  const toggleSelection = useCallback((name: string) => {
    setSelected((previous) => {
      const next = { ...previous };
      if (next[name]) {
        delete next[name];
      } else {
        next[name] = true;
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((previous) => {
      const shouldSelectAll = !allSelected;
      if (!shouldSelectAll) {
        return {};
      }
      const updated: SelectedMap = {};
      for (const name of selectableNames) {
        updated[name] = true;
      }
      return updated;
    });
  }, [allSelected, selectableNames]);

  const runAction = useCallback(
    async (action: ServiceAction, explicitTargets?: string[]) => {
      const usedBulkSelection = explicitTargets === undefined;
      const targets = explicitTargets ?? selectableNames.filter((name) => selected[name]);
      if (targets.length === 0) {
        return;
      }

      setBusyAction(action);
      setActionError(null);

      const payload = JSON.stringify({ services: targets });

      try {
        const response = await fetch(`/api/services/actions/${action}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: payload,
        });

        if (!response.ok) {
          // Preserve selections so the operator can retry without reselecting the same services.
          const errorBody = await response.json().catch(() => ({}));
          const detail = typeof errorBody.detail === "string" ? `: ${errorBody.detail}` : "";
          throw new Error(`Action ${action} failed${detail}`);
        }

        // Refresh service status after successful action execution.
        await refreshServices();
        if (usedBulkSelection) {
          // Clearing selections ensures the header checkbox resets to the "none" state. We only
          // run this branch for true bulk operations so a single row command does not clobber a
          // multi-service selection the operator might be staging.
          setSelected({});
        }
      } catch (error) {
        setActionError(extractErrorMessage(error));
      } finally {
        setBusyAction(null);
      }
    },
    [refreshServices, selectableNames, selected]
  );

  const renderStatus = (service: ServiceRow): string => {
    if (!service.status) {
      return "Unknown";
    }
    return service.status;
  };

  return (
    <div className="services-dashboard">
      <header className="services-dashboard__header">
        <h1>Services</h1>
        <button onClick={() => void refreshServices()} disabled={loading}>
          Refresh
        </button>
      </header>

      {loadError && <div className="error">{loadError}</div>}

      <section className="services-dashboard__actions">
        <div className="actions-group">
          <button
            onClick={() => void runAction("start")}
            disabled={busyAction !== null || selectedCount === 0}
          >
            Start Selected
          </button>
          <button
            onClick={() => void runAction("stop")}
            disabled={busyAction !== null || selectedCount === 0}
          >
            Stop Selected
          </button>
          <button
            onClick={() => void runAction("restart")}
            disabled={busyAction !== null || selectedCount === 0}
          >
            Restart Selected
          </button>
        </div>
        <div className="selection-summary">
          {selectedCount === 0 ? "No services selected" : `${selectedCount} service${selectedCount > 1 ? "s" : ""} selected`}
        </div>
      </section>

      {actionError && <div className="error">{actionError}</div>}

      <table className="services-dashboard__table">
        <thead>
          <tr>
            <th>
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-checked={isIndeterminate ? "mixed" : allSelected}
              />
            </th>
            <th>Name</th>
            <th>Status</th>
            <th>Project</th>
            <th>Last Change</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {services.map((service) => {
            const isChecked = Boolean(selected[service.name]);
            return (
              <tr key={service.name}>
                <td>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelection(service.name)}
                    aria-label={`Select service ${service.name}`}
                  />
                </td>
                <td>{service.name}</td>
                <td>{renderStatus(service)}</td>
                <td>{service.compose_project ?? "-"}</td>
                <td>{service.last_state_change ?? "-"}</td>
                <td>
                  <button
                    onClick={() => void runAction("start", [service.name])}
                    disabled={busyAction !== null}
                  >
                    Start
                  </button>
                  <button
                    onClick={() => void runAction("stop", [service.name])}
                    disabled={busyAction !== null}
                  >
                    Stop
                  </button>
                  <button
                    onClick={() => void runAction("restart", [service.name])}
                    disabled={busyAction !== null}
                  >
                    Restart
                  </button>
                </td>
              </tr>
            );
          })}
          {services.length === 0 && !loading && (
            <tr>
              <td colSpan={6}>No services discovered.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ServicesDashboard;
