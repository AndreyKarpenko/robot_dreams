import {
  call,
  fail,
  insertProduct,
  insertUser,
  login,
  newTraceParent,
  openPool,
  print,
  quietMark,
  requireEnv,
  resetDemoData,
  sleep,
  startApp,
  verdict,
  type RunningApp,
} from './support';
import { findErrorTraces, loadTrace, type JaegerSpan } from './jaeger';

/**
 * Claim: one key opens both doors. A checkout that ends in 500 is found in
 * the trace store by time and error alone; its trace_id equals the one in
 * the incoming traceparent and the one on the error log line.
 */
async function main(): Promise<void> {
  // The API reads OTEL_EXPORTER_OTLP_ENDPOINT itself; without it no span leaves.
  requireEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
  const traceApi = requireEnv('TRACE_API_URL');

  const pool = openPool();
  let app: RunningApp | undefined;
  try {
    await resetDemoData(pool);
    const seller = await insertUser(pool, 'seller');
    const buyer = await insertUser(pool, 'buyer');
    // 2 x 2e9 cents does not fit orders.total (int4): Postgres rejects the
    // INSERT, the transaction rolls back, the client gets 500.
    const pricey = await insertProduct(pool, seller.id, 2_000_000_000);

    app = await startApp();
    const token = await login(app.base, buyer.email);

    const tp = newTraceParent();
    const startedUs = Date.now() * 1000;
    const mark = await quietMark(app);
    const reply = await call(app.base, '/orders', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, traceparent: tp.header },
      body: { items: [{ product_id: pricey, quantity: 2 }] },
    });
    await sleep(300);
    const lines = app.lines.slice(mark);
    // SIGTERM -> TracerProvider.shutdown() -> the last batch is exported.
    await app.stop();
    app = undefined;

    const errorLines = lines
      .map((l) => l.json)
      .filter((j): j is Record<string, unknown> => j !== null)
      .filter((j) => j.level === 'error');
    const logIds = new Set(errorLines.map((j) => String(j.trace_id)));
    const logTraceId = logIds.size === 1 ? [...logIds][0] : '';

    // Search by service, time window and error — not by the id we sent.
    const found = await findErrorTraces(traceApi, startedUs);
    const traceId = found.length === 1 ? found[0] : '';
    const spans: JaegerSpan[] = traceId
      ? await loadTrace(traceApi, traceId)
      : [];

    const ids = new Set(spans.map((s) => s.spanID));
    const parentOf = (s: JaegerSpan): string | undefined =>
      s.references.find((r) => r.refType === 'CHILD_OF')?.spanID;
    const orphans = spans.filter((s) => {
      const parent = parentOf(s);
      return parent !== undefined && !ids.has(parent) && parent !== tp.parentId;
    });
    const server = spans.find(
      (s) => tag(s, 'span.kind') === 'server' && parentOf(s) === tp.parentId,
    );

    const rows = {
      status: reply.status,
      'error-log-lines': errorLines.length,
      'traces-found': found.length,
      spans: spans.length,
      'db-spans': spans.filter(
        (s) =>
          tag(s, 'db.system.name') !== undefined ||
          tag(s, 'db.system') !== undefined,
      ).length,
      'orphan-spans': orphans.length,
      'trace-matches-header': traceId !== '' && traceId === tp.traceId ? 1 : 0,
      'trace-matches-log': traceId !== '' && traceId === logTraceId ? 1 : 0,
      'span-status-error':
        server && tag(server, 'otel.status_code') === 'ERROR' ? 1 : 0,
    };
    print(rows);
    verdict({
      'status=5xx': rows.status >= 500,
      'traces-found=1': rows['traces-found'] === 1,
      'spans>=2': rows.spans >= 2,
      'orphan-spans=0': rows['orphan-spans'] === 0,
      'trace-matches-header=1': rows['trace-matches-header'] === 1,
      'trace-matches-log=1': rows['trace-matches-log'] === 1,
      'span-status-error=1': rows['span-status-error'] === 1,
    });
  } finally {
    await app?.stop();
    await resetDemoData(pool);
    await pool.end();
  }
}

function tag(span: JaegerSpan, key: string): string | undefined {
  const found = span.tags.find((t) => t.key === key);
  return found === undefined ? undefined : String(found.value);
}

void main().catch(fail);
