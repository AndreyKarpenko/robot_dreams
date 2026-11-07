import { sleep } from './support';

/** Must match OTEL_SERVICE_NAME / the API's default resource name. */
const SERVICE = process.env.OTEL_SERVICE_NAME?.trim() || 'marketplace-api';
const DEADLINE_MS = 20_000;

export type JaegerSpan = {
  traceID: string;
  spanID: string;
  operationName: string;
  references: Array<{ refType: string; traceID: string; spanID: string }>;
  tags: Array<{ key: string; type: string; value: unknown }>;
};

type TracesResponse = {
  data?: Array<{ traceID: string; spans: JaegerSpan[] }>;
};

/**
 * 5xx traces of this service that started after `sinceUs`. Polls: the
 * collector receives the batch asynchronously after the API flushed it.
 * Jaeger derives `error` / `otel.status_code` from the span status and does
 * not index them, so the search goes by the HTTP attribute; the ERROR status
 * is checked on the span itself.
 */
export async function findErrorTraces(
  base: string,
  sinceUs: number,
): Promise<string[]> {
  const deadline = Date.now() + DEADLINE_MS;
  let ids: string[] = [];
  while (Date.now() < deadline) {
    const params = new URLSearchParams({
      service: SERVICE,
      start: String(sinceUs),
      end: String(Date.now() * 1000 + 60_000_000),
      limit: '20',
      tags: JSON.stringify({ 'http.response.status_code': '500' }),
    });
    const body = await getJson(`${base}/api/traces?${params.toString()}`);
    ids = [...new Set((body.data ?? []).map((t) => t.traceID))];
    if (ids.length > 0) {
      return ids;
    }
    await sleep(500);
  }
  return ids;
}

/** All spans of one trace, once two reads in a row agree on the count. */
export async function loadTrace(
  base: string,
  traceId: string,
): Promise<JaegerSpan[]> {
  const deadline = Date.now() + DEADLINE_MS;
  let previous = -1;
  let spans: JaegerSpan[] = [];
  while (Date.now() < deadline) {
    const body = await getJson(`${base}/api/traces/${traceId}`);
    spans = body.data?.[0]?.spans ?? [];
    if (spans.length > 0 && spans.length === previous) {
      return spans;
    }
    previous = spans.length;
    await sleep(500);
  }
  return spans;
}

async function getJson(url: string): Promise<TracesResponse> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {};
    }
    return (await res.json()) as TracesResponse;
  } catch {
    return {};
  }
}
