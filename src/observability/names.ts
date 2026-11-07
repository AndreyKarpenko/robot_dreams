export const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME?.trim() || 'marketplace-api';

/** Probes and scrapes: no span, no access log line, no RED sample. */
export const UNTRACED_PATHS = new Set(['/metrics', '/health']);
