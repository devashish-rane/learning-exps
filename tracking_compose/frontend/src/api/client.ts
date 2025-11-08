import { API_BASE_URL, CORRELATION_HEADER } from '../config';

/**
 * A typed error describing API failures. Shipping the correlation id in the
 * error makes it trivial to grep backend logs or trace synthetic transactions
 * without the UI needing to display verbose stack traces to end users.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly correlationId: string;
  readonly detail?: unknown;

  constructor(message: string, status: number, correlationId: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.correlationId = correlationId;
    this.detail = detail;
  }
}

/**
 * Generate a RFC4122 correlation id with a robust fallback for environments
 * where `crypto.randomUUID` is unavailable (older Safari versions, headless
 * test runners). The fallback still encodes enough entropy for log analysis.
 */
function nextCorrelationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Shared fetch helper that injects standard headers, enforces JSON semantics,
 * and unwraps error payloads into rich ApiError instances. The goal is to keep
 * request plumbing consistent across components while documenting subtle
 * behaviours like FastAPI returning text bodies on 502s (Compose diagnostics).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const correlationId = nextCorrelationId();
  const headers: HeadersInit = {
    Accept: 'application/json',
    [CORRELATION_HEADER]: correlationId,
    ...init.headers,
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let detail: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    try {
      if (contentType.includes('application/json')) {
        detail = await response.json();
      } else {
        detail = await response.text();
      }
    } catch (error) {
      detail = `Failed to parse error payload: ${(error as Error).message}`;
    }

    throw new ApiError(
      `Request to ${path} failed with status ${response.status}`,
      response.status,
      correlationId,
      detail
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Lightweight wrapper for JSON POST requests. Having a dedicated helper means
 * we always stringify payloads and set the right content type, avoiding the
 * class of bugs where Compose actions fail because FastAPI cannot parse the
 * body. The caller still inherits the structured ApiError handling.
 */
export function apiPost<T>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}
