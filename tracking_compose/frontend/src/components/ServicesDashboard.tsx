import React, {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Representation of a service row returned by the tracking compose backend.
 *
 * Only the fields that are consumed by the dashboard are modeled here so the UI remains decoupled
 * from backend implementation details. Additional properties can be layered in without touching the
 * selection logic introduced in this file as long as the `name` field stays unique.
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
 * Normalize any thrown value into a human readable error message.
 *
 * When we bubble errors back into the UI we strongly prefer predictable strings; otherwise React may
 * render `[object Object]` or similar placeholders that do not help when triaging production issues.
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
 * Safely attempt to parse a JSON response body.
 *
 * Some endpoints respond with plain text or an empty body when errors bubble from reverse proxies.
 * Rather than throwing secondary parsing errors we fallback to an empty object so the caller can
 * decide how to surface the failure.
 */
async function tryParseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
      console.debug("Failed to parse JSON response body", error);
    }
    return {};
  }
}

/**
 * ServicesDashboard renders the list of docker-compose managed services alongside action controls.
 *
 * The dashboard now owns bulk selection state, driven by a header-level checkbox whose checked and
 * indeterminate states are derived from the existing selection map. The wiring allows operators to
 * select the full inventory quickly, while ensuring we do not accidentally clear selections after
 * API errors (to make retries painless).
 */
const ServicesDashboard: React.FC = () => {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedMap>({});
  const [busyAction, setBusyAction] = useState<ServiceAction | null>(null);

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  /**
   * Track only the identifiers of services that can be selected. When the backend response changes,
   * `selectableNames` will refresh and downstream memoized values automatically recompute.
   */
  const selectableNames = useMemo(() => services.map((service) => service.name), [services]);

  /**
   * The list of currently selected service names. We keep the result memoized to avoid re-computing
   * within render loops and to ensure stable references in dependency arrays.
   */
  const selectedNames = useMemo(
    () => selectableNames.filter((name) => Boolean(selected[name])),
    [selectableNames, selected]
  );

  const selectedCount = selectedNames.length;
  const selectableCount = selectableNames.length;

  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  const isIndeterminate = selectedCount > 0 && !allSelected;
  const headerAriaChecked = isIndeterminate ? "mixed" : allSelected ? "true" : "false";

  /**
   * Sync the native `indeterminate` state of the header checkbox whenever the memoized flag changes.
   *
   * React does not treat `indeterminate` as a controllable prop, so we toggle it directly on the DOM
   * node. Forgetting this hook would cause browsers to render stale visual states, which is a subtle
   * failure that operators would only notice after bulk commands are executed.
   */
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  /**
   * Prune selections that no longer exist after a refresh.
   *
   * Without this guard the header checkbox could remain indeterminate if the backend removes a row
   * (for example, when a service definition is renamed). We only update state when a difference is
   * detected to prevent unnecessary renders.
   */
  useEffect(() => {
    setSelected((previous) => {
      const next: SelectedMap = {};
      for (const name of selectableNames) {
        if (previous[name]) {
          next[name] = true;
        }
      }

      const previousKeys = Object.keys(previous).filter((key) => previous[key]);
      const nextKeys = Object.keys(next);
      if (previousKeys.length === nextKeys.length && previousKeys.every((key) => next[key])) {
        return previous;
      }
      return next;
    });
  }, [selectableNames]);

  /**
   * Fetch the latest service inventory.
   *
   * The helper accepts an optional AbortSignal so we can safely cancel the request when the component
   * unmounts. That avoids noisy React warnings about state updates on unmounted components during
   * deployments where hot reloads are frequent.
   */
  const refreshServices = useCallback(
    async (signal?: AbortSignal) => {
      if (signal?.aborted) {
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const response = await fetch("/api/services", { signal });
        if (!response.ok) {
          throw new Error(`Unable to load services (HTTP ${response.status}).`);
        }

        const payload = (await tryParseJson(response)) as ServiceRow[];
        if (!Array.isArray(payload)) {
          throw new Error("Received malformed service inventory from the API.");
        }

        if (!signal?.aborted) {
          setServices(payload);
        }
      } catch (error) {
        if ((error as Error)?.name === "AbortError") {
          return;
        }
        setLoadError(extractErrorMessage(error));
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshServices(controller.signal);

    return () => {
      controller.abort();
    };
  }, [refreshServices]);

  /**
   * Toggle an individual selection.
   */
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

  /**
   * Toggle the header checkbox.
   *
   * We recompute the desired bulk state from the current selection instead of trusting the event
   * target. This avoids edge cases where React may coalesce events and leave us with an outdated DOM
   * value (observed sporadically in integration tests when rapid toggles occur).
   */
  const toggleAll = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      setSelected((previous) => {
        const everySelected = selectableNames.every((name) => Boolean(previous[name]));
        if (everySelected) {
          return {};
        }
        const updated: SelectedMap = {};
        for (const name of selectableNames) {
          updated[name] = true;
        }
        return updated;
      });
    },
    [selectableNames]
  );

  /**
   * Execute an action against either the current selection or an explicit list of targets.
   *
   * The logic keeps the header checkbox in sync by clearing bulk selections only after a successful
   * response. When a request fails we surface the error and preserve the chosen services so the user
   * can immediately retry without re-selecting rows.
   */
  const runAction = useCallback(
    async (action: ServiceAction, explicitTargets?: string[]) => {
      const usedBulkSelection = explicitTargets === undefined;
      const targets = explicitTargets ?? selectedNames;
      if (targets.length === 0) {
        return;
      }

      setBusyAction(action);
      setActionError(null);

      try {
        const response = await fetch(`/api/services/actions/${action}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ services: targets }),
        });

        if (!response.ok) {
          const errorBody = await tryParseJson(response);
          const detail =
            typeof errorBody === "object" &&
            errorBody !== null &&
            "detail" in errorBody &&
            typeof (errorBody as { detail?: unknown }).detail === "string"
              ? `: ${(errorBody as { detail: string }).detail}`
              : "";
          throw new Error(`Action ${action} failed${detail}`);
        }

        await refreshServices();

        if (usedBulkSelection) {
          setSelected({});
        }
      } catch (error) {
        setActionError(extractErrorMessage(error));
      } finally {
        setBusyAction(null);
      }
    },
    [refreshServices, selectedNames]
  );

  const renderStatus = (service: ServiceRow): string => {
    if (!service.status) {
      return "Unknown";
    }
    return service.status;
  };

  const isBulkActionDisabled = busyAction !== null || selectedCount === 0;

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
          <button onClick={() => void runAction("start")} disabled={isBulkActionDisabled}>
            Start Selected
          </button>
          <button onClick={() => void runAction("stop")} disabled={isBulkActionDisabled}>
            Stop Selected
          </button>
          <button onClick={() => void runAction("restart")} disabled={isBulkActionDisabled}>
            Restart Selected
          </button>
        </div>
        <div className="selection-summary" aria-live="polite">
          {selectedCount === 0
            ? "No services selected"
            : `${selectedCount} service${selectedCount > 1 ? "s" : ""} selected`}
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
                aria-checked={headerAriaChecked}
                aria-label="Select all services"
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
                  <button onClick={() => void runAction("start", [service.name])} disabled={busyAction !== null}>
                    Start
                  </button>
                  <button onClick={() => void runAction("stop", [service.name])} disabled={busyAction !== null}>
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
