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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const normalizeServicePayload = (payload: unknown): ServiceRow[] => {
  if (!Array.isArray(payload)) {
    throw new Error("Received unexpected payload from services API.");
  }

  const seen = new Set<string>();
  const normalized: ServiceRow[] = [];

  for (const item of payload) {
    if (!isRecord(item)) {
      continue;
    }

    const name = typeof item.name === "string" ? item.name : null;
    const status = typeof item.status === "string" ? item.status : null;
    if (!name || !status || seen.has(name)) {
      continue;
    }

    normalized.push({
      name,
      status,
      compose_project:
        typeof item.compose_project === "string" && item.compose_project.trim().length > 0
          ? item.compose_project
          : undefined,
      last_state_change:
        typeof item.last_state_change === "string" && item.last_state_change.trim().length > 0
          ? item.last_state_change
          : undefined,
    });
    seen.add(name);
  }

  return normalized;
};

/**
 * Render a checkable dashboard with bulk orchestration affordances for Compose services.
 *
 * The header checkbox mirrors the aggregate row selection state and exposes three distinct states:
 * unchecked, checked, and indeterminate. The indeterminate state avoids confusing operators when
 * only a subset of rows is active. We keep the checkbox state entirely declarative, which is critical
 * for React concurrent rendering where imperative flag toggles can easily go stale.
 */
const ServicesDashboard: React.FC = () => {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<ServiceAction | null>(null);
  const [selected, setSelected] = useState<SelectedMap>({});

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const servicesRequestRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      servicesRequestRef.current?.abort();
    };
  }, []);

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
      if (selectableNames.length === 0 && Object.keys(previous).length === 0) {
        return previous;
      }

      const next: SelectedMap = {};
      for (const name of selectableNames) {
        if (previous[name]) {
          next[name] = true;
        }
      }

      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(next);
      if (previousKeys.length === nextKeys.length && previousKeys.every((name) => next[name])) {
        return previous;
      }
      return next;
    });
  }, [selectableNames]);

  const refreshServices = useCallback(async () => {
    servicesRequestRef.current?.abort();
    const controller = new AbortController();
    servicesRequestRef.current = controller;

    if (isMountedRef.current) {
      setLoading(true);
      setLoadError(null);
    }

    try {
      const response = await fetch("/api/services", { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Unable to load services (HTTP ${response.status}).`);
      }

      const payload: unknown = await response.json();
      const normalized = normalizeServicePayload(payload);

      if (controller.signal.aborted || !isMountedRef.current) {
        return;
      }

      setServices(normalized);
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError" || controller.signal.aborted || !isMountedRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unexpected error loading services.";
      setLoadError(message);
      setServices([]);
    } finally {
      if (!controller.signal.aborted && isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshServices();
  }, [refreshServices]);

  const toggleService = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = event.target;
    setSelected((previous) => {
      if (checked) {
        if (previous[name]) {
          return previous;
        }
        return { ...previous, [name]: true };
      }

      if (!previous[name]) {
        return previous;
      }

      const next = { ...previous };
      delete next[name];
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectableNames.length === 0) {
      setSelected({});
      return;
    }

    setSelected((previous) => {
      const shouldSelectAll = selectableNames.some((name) => !previous[name]);
      if (!shouldSelectAll) {
        if (Object.keys(previous).length === 0) {
          return previous;
        }
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
      return selectedNames.length > 0 ? [...selectedNames] : [];
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
            if (isRecord(body) && typeof body.detail === "string") {
              detail = body.detail;
            }
          } catch (parseError) {
            if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
              console.debug("Unable to parse action error response", parseError);
            }
          }

          const fallback = `Failed to ${action} ${servicesToAffect.length > 1 ? "services" : "service"}.`;
          throw new Error(detail ?? fallback);
        }

        await refreshServices();

        setSelected((previous) => {
          if (target) {
            if (!previous[target]) {
              return previous;
            }
            const next = { ...previous };
            delete next[target];
            return next;
          }

          if (Object.keys(previous).length === 0) {
            return previous;
          }
          return {};
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error while running action.";
        setActionError(message);
      } finally {
        setBusyAction(null);
      }
    },
    [refreshServices, servicesForAction]
  );

  const bulkDisabled = busyAction !== null || selectedCount === 0;

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
        <button type="button" onClick={() => void runAction("start")} disabled={bulkDisabled}>
          Start Selected
        </button>
        <button type="button" onClick={() => void runAction("stop")} disabled={bulkDisabled}>
          Stop Selected
        </button>
        <button type="button" onClick={() => void runAction("restart")} disabled={bulkDisabled}>
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
