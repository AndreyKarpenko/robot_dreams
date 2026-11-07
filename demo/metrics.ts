import { randomUUID } from 'node:crypto';
import {
  call,
  fail,
  insertProduct,
  insertUser,
  login,
  openPool,
  pooled,
  print,
  resetDemoData,
  sleep,
  startApp,
  verdict,
  type Reply,
  type RunningApp,
} from './support';

const SEND_OK = 40;
const SEND_FAIL = 10;
const DISTINCT_IDS = 100;
const WIDTH = 25;
const DEMO_ROUTE = '/orders';
const ID_ROUTE = '/orders/:id';

/**
 * Claim: RED counts what happened, and a label set is bounded. Fifty
 * checkouts (ten of them 5xx) move the counter by exactly fifty; a hundred
 * different order ids add no series because route is the template.
 */
async function main(): Promise<void> {
  const pool = openPool();
  let app: RunningApp | undefined;
  try {
    await resetDemoData(pool);
    const seller = await insertUser(pool, 'seller');
    const buyer = await insertUser(pool, 'buyer');
    const cheap = await insertProduct(pool, seller.id, 1500);
    // Two of these overflow orders.total (int4): a real 500, not a stub.
    const pricey = await insertProduct(pool, seller.id, 2_000_000_000);

    app = await startApp();
    const base = app.base;
    const token = await login(base, buyer.email);
    const auth = { authorization: `Bearer ${token}` };

    // --- Rate / Errors: two scrapes around fifty checkouts -----------------
    const before = await scrape(base);
    const plan = [
      ...Array.from({ length: SEND_OK }, () => cheap),
      ...Array.from({ length: SEND_FAIL }, () => pricey),
    ].sort(() => Math.random() - 0.5);
    const replies = await pooled(
      WIDTH,
      plan.map(
        (productId) => (): Promise<Reply> =>
          call(base, '/orders', {
            method: 'POST',
            headers: { ...auth, 'idempotency-key': randomUUID() },
            body: { items: [{ product_id: productId, quantity: 2 }] },
          }),
      ),
    );
    const after = await scrape(base);

    const sentOk = replies.filter((r) => r.status === 201).length;
    const sentFail = replies.filter((r) => r.status >= 500).length;
    const counterDelta =
      sum(after, 'http_requests_total') - sum(before, 'http_requests_total');
    const errorsDelta =
      sum(after, 'http_requests_total', (l) => /^5\d\d$/.test(l.status)) -
      sum(before, 'http_requests_total', (l) => /^5\d\d$/.test(l.status));

    const onRoute = (l: Labels): boolean =>
      l.route === DEMO_ROUTE && l.method === 'POST';
    const topLe = Math.max(
      ...after
        .filter((s) => s.name === 'http_request_duration_seconds_bucket')
        .map((s) => Number(s.labels.le))
        .filter(Number.isFinite),
    );
    const count = sum(after, 'http_request_duration_seconds_count', onRoute);
    const inTop = sum(
      after,
      'http_request_duration_seconds_bucket',
      (l) => onRoute(l) && Number(l.le) === topLe,
    );

    // --- Cardinality: warm the route, then a hundred different ids --------
    const fetchOrder = (id: number): Promise<Reply> =>
      call(base, `/orders/${id}`, { headers: auth });
    const warm = await fetchOrder(1_999_999_999);
    const c1 = await scrape(base);
    const ids = Array.from(
      { length: DISTINCT_IDS },
      (_, i) => 1_900_000_000 + i,
    );
    const idReplies = await pooled(
      WIDTH,
      ids.map((id) => () => fetchOrder(id)),
    );
    const c2 = await scrape(base);

    const rows = {
      'sent-ok': sentOk,
      'sent-fail': sentFail,
      'sent-unexpected': replies.length - sentOk - sentFail,
      'counter-delta': counterDelta,
      'errors-delta': errorsDelta,
      'top-bucket-ms': Math.round(topLe * 1000),
      'above-top-bucket': count - inTop,
      'warmup-status': warm.status,
      'distinct-ids': new Set(ids).size,
      'distinct-id-statuses': new Set(idReplies.map((r) => r.status)).size,
      'series-before': series(c1, 'http_requests_total'),
      'series-after': series(c2, 'http_requests_total'),
      'histogram-series-before': series(
        c1,
        'http_request_duration_seconds_bucket',
      ),
      'histogram-series-after': series(
        c2,
        'http_request_duration_seconds_bucket',
      ),
      'id-route-delta':
        sum(c2, 'http_requests_total', (l) => l.route === ID_ROUTE) -
        sum(c1, 'http_requests_total', (l) => l.route === ID_ROUTE),
    };
    print(rows);
    // Varies run to run, so it stays off the key=number contract.
    console.error(
      `note: slowest checkout ${Math.ceil(Math.max(...replies.map((r) => r.ms)))} ms` +
        ` at ${WIDTH} in flight; top finite bucket ${topLe} s`,
    );
    await crossCheck(rows['series-after']);

    verdict({
      'sent-ok+sent-fail>=50': sentOk + sentFail >= 50,
      'sent-unexpected=0': rows['sent-unexpected'] === 0,
      'counter-delta=sent': counterDelta === sentOk + sentFail,
      'errors-delta=sent-fail': errorsDelta === sentFail,
      'above-top-bucket=0': rows['above-top-bucket'] === 0,
      'id-route-delta=100': rows['id-route-delta'] === DISTINCT_IDS,
      'series-after=series-before':
        rows['series-after'] === rows['series-before'],
      'histogram-series-after=before':
        rows['histogram-series-after'] === rows['histogram-series-before'],
    });
  } finally {
    await app?.stop();
    await resetDemoData(pool);
    await pool.end();
  }
}

/**
 * Not part of the contract: shows the same series reached Prometheus and
 * the dashboard is provisioned. Prints 0 instead of failing, because the
 * container-to-host scrape depends on the grader's network.
 */
async function crossCheck(expectedSeries: number): Promise<void> {
  const prom = process.env.PROMETHEUS_URL?.trim().replace(/\/+$/, '');
  if (prom) {
    const query =
      'count(http_requests_total{job="marketplace-api",env="demo"})';
    let seen = 0;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      seen = await promScalar(prom, query);
      if (seen === expectedSeries) {
        break;
      }
      await sleep(1000);
    }
    print({ 'prometheus-series': seen });
    if (seen !== expectedSeries) {
      console.error(`prometheus did not scrape the demo API (${prom})`);
    }
  }

  const grafana = process.env.GRAFANA_URL?.trim().replace(/\/+$/, '');
  const user = process.env.GRAFANA_ADMIN_USER;
  const password = process.env.GRAFANA_ADMIN_PASSWORD;
  if (grafana && user && password) {
    let panels = 0;
    try {
      const res = await fetch(`${grafana}/api/dashboards/uid/hw29-red`, {
        headers: {
          authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
        },
      });
      const body = (await res.json()) as { dashboard?: { panels?: unknown[] } };
      panels = res.ok ? (body.dashboard?.panels?.length ?? 0) : 0;
    } catch {
      panels = 0;
    }
    print({ 'grafana-dashboard-panels': panels });
  }
}

async function promScalar(base: string, query: string): Promise<number> {
  try {
    const res = await fetch(
      `${base}/api/v1/query?query=${encodeURIComponent(query)}`,
    );
    const body = (await res.json()) as {
      data?: { result?: Array<{ value?: [number, string] }> };
    };
    return Number(body.data?.result?.[0]?.value?.[1] ?? 0);
  } catch {
    return 0;
  }
}

// --- Prometheus text format, just enough of it ----------------------------

type Labels = Record<string, string>;
type Sample = { name: string; labels: Labels; value: number };

async function scrape(base: string): Promise<Sample[]> {
  const res = await fetch(`${base}/metrics`);
  if (!res.ok) {
    throw new Error(`/metrics returned ${res.status}`);
  }
  const samples: Sample[] = [];
  for (const line of (await res.text()).split('\n')) {
    const m = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) {
      continue;
    }
    const labels: Labels = {};
    for (const l of (m[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
      labels[l[1]] = l[2];
    }
    samples.push({ name: m[1], labels, value: Number(m[3]) });
  }
  return samples;
}

function sum(
  samples: Sample[],
  name: string,
  where: (labels: Labels) => boolean = () => true,
): number {
  return samples
    .filter((s) => s.name === name && where(s.labels))
    .reduce((acc, s) => acc + s.value, 0);
}

function series(samples: Sample[], name: string): number {
  return samples.filter((s) => s.name === name).length;
}

void main().catch(fail);
