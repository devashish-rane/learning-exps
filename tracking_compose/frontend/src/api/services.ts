import { apiFetch, apiPost } from './client';

export interface Service {
  name: string;
  status: string;
  last_state_change: string;
  compose_project: string;
  ports: Record<string, string>;
  tags: string[];
  depends_on: string[];
  profiles: string[];
  base_urls: string[];
  health_urls: string[];
  docs_urls: string[];
  metrics_urls: string[];
}

export type HealthSnapshot = Record<
  string,
  {
    service_name: string;
    healthy: boolean;
    latency_ms: number | null;
    status_code: number | null;
    url: string | null;
    taken_at: string;
    details: Record<string, unknown>;
  }
>;

export type HttpMetrics = Record<
  string,
  Array<{
    endpoint: string;
    method: string;
    p50_ms: number | null;
    p90_ms: number | null;
    p99_ms: number | null;
    error_rate: number | null;
  }>
>;

export interface TraceResponse {
  trace_id?: string;
  spans?: Array<Record<string, unknown>>;
  lines?: string[];
  [key: string]: unknown;
}

export function fetchServices(): Promise<Service[]> {
  return apiFetch<Service[]>('/api/services');
}

export function serviceAction(
  action: 'start' | 'stop' | 'restart',
  services: string[]
): Promise<{ status: string; services: string[] }> {
  return apiPost(`/api/services/actions/${action}`, { services });
}

export function fetchHealth(): Promise<HealthSnapshot> {
  return apiFetch<HealthSnapshot>('/api/health');
}

export function fetchHttpMetrics(): Promise<HttpMetrics> {
  return apiFetch<HttpMetrics>('/api/metrics/http');
}

export function fetchTrace(traceId: string): Promise<TraceResponse> {
  return apiFetch<TraceResponse>(`/api/traces/${encodeURIComponent(traceId)}`);
}
