/**
 * Centralized runtime configuration that keeps the fetch layer honest about
 * where the FastAPI backend lives. Leave the variable empty for same-origin
 * deployments (requests will target `/api/*`). When pointing at a remote
 * backend use a host-only value such as `https://dockhand.example.com` to
 * avoid accidentally doubling `/api` in the final URL.
 */
const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Normalized API base without a trailing slash to avoid accidental double
 * slashes when building request URLs.
 */
export const API_BASE_URL = rawBaseUrl.replace(/\/$/, '');

/**
 * Correlation header name shared across the frontend and backend logs. We
 * inject this into every fetch so operations can trace which SPA interaction
 * triggered a backend call without enabling full tracing infrastructure.
 */
export const CORRELATION_HEADER = 'X-Dockhand-Correlation-Id';
