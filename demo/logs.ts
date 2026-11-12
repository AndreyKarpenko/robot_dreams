import { randomBytes, randomUUID } from 'node:crypto';
import {
  call,
  fail,
  insertProduct,
  insertUser,
  linesSince,
  login,
  newTraceParent,
  openPool,
  print,
  quietMark,
  resetDemoData,
  startApp,
  verdict,
  type LogLine,
  type Reply,
  type RunningApp,
  type TraceParent,
} from './support';

const BURST = 16;
const NONE = '<no trace_id>';

/**
 * Claim: the correlator lives in context, not in arguments. One checkout
 * crosses controller -> service -> repository under one trace_id equal to
 * the incoming traceparent; sixteen concurrent checkouts do not mix; the
 * token and password of a login request never reach the log.
 */
async function main(): Promise<void> {
  const pool = openPool();
  let app: RunningApp | undefined;
  try {
    await resetDemoData(pool);
    const seller = await insertUser(pool, 'seller');
    const buyer = await insertUser(pool, 'buyer');
    const productId = await insertProduct(pool, seller.id, 1500);

    app = await startApp();
    const token = await login(app.base, buyer.email);
    const checkout = (tp: TraceParent, key: string): Promise<Reply> =>
      call(app!.base, '/orders', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          traceparent: tp.header,
          'idempotency-key': key,
        },
        body: { items: [{ product_id: productId, quantity: 1 }] },
      });

    // One request alone: every line it produced, nothing else running.
    const single = newTraceParent();
    let mark = await quietMark(app);
    const one = await checkout(single, randomUUID());
    const singleLines = (await linesSince(app, mark)).filter(isJson);
    const singleIds = new Set(singleLines.map(traceIdOf));
    const layers = new Set(singleLines.map((l) => String(l.json.layer)));

    // Sixteen identical requests at once, each with its own traceparent.
    const burst = Array.from({ length: BURST }, () => ({
      tp: newTraceParent(),
      key: randomUUID(),
    }));
    mark = await quietMark(app);
    const burstReplies = await Promise.all(
      burst.map((b) => checkout(b.tp, b.key)),
    );
    const burstLines = (await linesSince(app, mark)).filter(isJson);
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const line of burstLines) {
      const id = traceIdOf(line);
      groups.set(id, [...(groups.get(id) ?? []), line.json]);
    }
    const sizes = burst.map((b) => groups.get(b.tp.traceId)?.length ?? 0);
    const modal = mode(sizes);
    const foreign = [...groups.keys()].filter(
      (id) => !burst.some((b) => b.tp.traceId === id),
    ).length;
    const burstUneven = sizes.filter((n) => n !== modal).length + foreign;
    // The ALS fields must travel with the trace, not with whoever ran last.
    const contextMismatch = burst.reduce((bad, b) => {
      const own = groups.get(b.tp.traceId) ?? [];
      return (
        bad +
        own.filter((j) => j.idempotency_key !== b.key || j.user_id !== buyer.id)
          .length
      );
    }, 0);

    // A login carrying a bearer token and a password, both marked.
    const tokenMarker = `hw29tok${randomBytes(8).toString('hex')}`;
    const passwordMarker = `hw29pwd${randomBytes(8).toString('hex')}`;
    const secret = newTraceParent();
    mark = await quietMark(app);
    const secretReply = await call(app.base, '/auth/login', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenMarker}`,
        traceparent: secret.header,
      },
      body: { email: 'hw29-nobody@shop.test', password: passwordMarker },
    });
    const secretLines = (await linesSince(app, mark))
      .filter(isJson)
      .filter((l) => traceIdOf(l) === secret.traceId);

    const everything = app.lines;
    await app.stop();
    app = undefined;

    const rows = {
      'single-status': one.status,
      'non-json-lines': everything.filter((l) => l.json === null).length,
      'single-lines': singleLines.length,
      layers: layers.size,
      'repo-lines': singleLines.filter((l) => l.json.layer === 'orders.repo')
        .length,
      'distinct-trace-ids': singleIds.size,
      'trace-id-matches-header':
        singleIds.size === 1 && singleIds.has(single.traceId) ? 1 : 0,
      burst: BURST,
      'burst-created': burstReplies.filter((r) => r.status === 201).length,
      'burst-trace-ids': groups.size,
      'burst-lines-per-request': modal,
      'burst-uneven': burstUneven,
      'burst-context-mismatch': contextMismatch,
      'secret-status': secretReply.status,
      'secret-req-logged': secretLines.length > 0 ? 1 : 0,
      'secret-redacted-fields': secretLines.reduce(
        (n, l) => n + (l.raw.match(/\[REDACTED\]/g)?.length ?? 0),
        0,
      ),
      'secret-in-logs': everything.filter(
        (l) => l.raw.includes(tokenMarker) || l.raw.includes(passwordMarker),
      ).length,
    };
    print(rows);
    verdict({
      'single-status=201': rows['single-status'] === 201,
      'non-json-lines=0': rows['non-json-lines'] === 0,
      'layers>=3': rows.layers >= 3,
      'repo-lines>=1': rows['repo-lines'] >= 1,
      'distinct-trace-ids=1': rows['distinct-trace-ids'] === 1,
      'trace-id-matches-header=1': rows['trace-id-matches-header'] === 1,
      'burst-created=burst': rows['burst-created'] === BURST,
      'burst-trace-ids=burst': rows['burst-trace-ids'] === BURST,
      'burst-uneven=0': rows['burst-uneven'] === 0,
      'burst-context-mismatch=0': rows['burst-context-mismatch'] === 0,
      'secret-status=401': rows['secret-status'] === 401,
      'secret-req-logged=1': rows['secret-req-logged'] === 1,
      'secret-in-logs=0': rows['secret-in-logs'] === 0,
    });
  } finally {
    await app?.stop();
    await resetDemoData(pool);
    await pool.end();
  }
}

type JsonLine = LogLine & { json: Record<string, unknown> };

function isJson(line: LogLine): line is JsonLine {
  return line.json !== null;
}

function traceIdOf(line: JsonLine): string {
  return typeof line.json.trace_id === 'string' ? line.json.trace_id : NONE;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

void main().catch(fail);
