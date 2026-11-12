import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID, scrypt as scryptCb } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

/** Every demo boots the API here; Prometheus scrapes the same port. */
export const APP_PORT = 22910;

const EMAIL_LIKE = 'hw29-%@shop.test';
const PASSWORD = 'hw29-demo-password';
const scrypt = promisify(scryptCb);

export type Rows = Record<string, number>;

export function print(rows: Rows): void {
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key}=${value}`);
  }
}

/** Each rule is a claim about the printed numbers; any false one fails the run. */
export function verdict(rules: Record<string, boolean>): void {
  const broken = Object.entries(rules)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (broken.length > 0) {
    console.error(`invariant violated: ${broken.join(', ')}`);
    process.exitCode = 1;
  }
}

export function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set (vault or export, see README ## Grading)`,
    );
  }
  return value.replace(/\/+$/, '');
}

export type TraceParent = { header: string; traceId: string; parentId: string };

/** W3C Trace Context: 00-<32 hex trace-id>-<16 hex parent-id>-01 (sampled). */
export function newTraceParent(): TraceParent {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  return { header: `00-${traceId}-${parentId}-01`, traceId, parentId };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- database -------------------------------------------------------------

export function openPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (url) {
    return new Pool({ connectionString: url, max: 2 });
  }
  const { DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_PORT || !DB_USER || !DB_NAME) {
    throw new Error('Set DATABASE_URL or DB_HOST, DB_PORT, DB_USER, DB_NAME');
  }
  return new Pool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    max: 2,
  });
}

/** Removes everything earlier hw29 runs left: users, products, orders, outbox. */
export async function resetDemoData(pool: Pool): Promise<void> {
  const buyers = `SELECT o.id FROM orders o JOIN users u ON u.id = o.buyer_id
                   WHERE u.email LIKE $1`;
  await pool.query(
    `DELETE FROM outbox WHERE aggregate_id IN (SELECT id::text FROM (${buyers}) b)`,
    [EMAIL_LIKE],
  );
  await pool.query(`DELETE FROM orders WHERE id IN (${buyers})`, [EMAIL_LIKE]);
  await pool.query(
    `DELETE FROM products
      WHERE seller_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [EMAIL_LIKE],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [EMAIL_LIKE]);
}

export async function insertUser(
  pool: Pool,
  role: 'buyer' | 'seller',
): Promise<{ id: string; email: string }> {
  const email = `hw29-${role}-${randomUUID()}@shop.test`;
  const salt = randomBytes(16);
  const hash = (await scrypt(PASSWORD, salt, 32)) as Buffer;
  const stored = `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, balance, role, password_hash)
     VALUES ($1, $2, 0, $3, $4) RETURNING id`,
    [email, `hw29 ${role}`, role, stored],
  );
  return { id: result.rows[0].id, email };
}

export async function insertProduct(
  pool: Pool,
  sellerId: string,
  priceCents: number,
): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO products (name, price, stock, seller_id)
     VALUES ($1, $2, 1000000, $3) RETURNING id`,
    [`hw29 product ${randomUUID()}`, priceCents, sellerId],
  );
  return Number(result.rows[0].id);
}

// --- the API process -------------------------------------------------------

export type LogLine = { raw: string; json: Record<string, unknown> | null };

export type RunningApp = {
  base: string;
  /** Every non-empty line the process wrote, stdout and stderr together. */
  lines: LogLine[];
  stop(): Promise<void>;
};

export async function startApp(
  env: NodeJS.ProcessEnv = {},
): Promise<RunningApp> {
  const child = spawn(process.execPath, [join(__dirname, '..', 'main.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      LOG_LEVEL: 'debug',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: LogLine[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    let partial = '';
    stream?.on('data', (chunk: Buffer) => {
      partial += chunk.toString('utf8');
      const parts = partial.split('\n');
      partial = parts.pop() ?? '';
      for (const raw of parts) {
        if (raw.trim() !== '') {
          lines.push({ raw, json: parseObject(raw) });
        }
      }
    });
  }
  const kill = (): void => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  };
  process.on('exit', kill);

  const base = `http://127.0.0.1:${APP_PORT}`;
  try {
    await waitHealthy(child, base, lines);
  } catch (err) {
    kill();
    throw err;
  }
  return {
    base,
    lines,
    async stop() {
      process.removeListener('exit', kill);
      await stopChild(child);
    },
  };
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function waitHealthy(
  child: ChildProcess,
  base: string,
  lines: LogLine[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = 'not started';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const tail = lines
        .slice(-20)
        .map((l) => l.raw)
        .join('\n');
      throw new Error(`API exited ${child.exitCode} before listen\n${tail}`);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        return;
      }
      last = `health ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(150);
  }
  throw new Error(`API did not become healthy on ${base} (${last})`);
}

/** SIGTERM lets the API flush its span batch before it exits. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timer);
}

/**
 * Index to start a window from, once the API stopped writing. The access
 * line of the previous request is written on 'close', which can land after
 * the client already has the body.
 */
export async function quietMark(app: RunningApp): Promise<number> {
  let seen = -1;
  while (seen !== app.lines.length) {
    seen = app.lines.length;
    await sleep(250);
  }
  return seen;
}

/** Lines appended after `from`, once the API has had a moment to write them. */
export async function linesSince(
  app: RunningApp,
  from: number,
): Promise<LogLine[]> {
  await sleep(300);
  return app.lines.slice(from);
}

// --- HTTP -----------------------------------------------------------------

export type Reply = { status: number; body: unknown; ms: number };

export async function call(
  base: string,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const started = performance.now();
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // plain text is fine
  }
  return { status: res.status, body, ms };
}

export async function login(base: string, email: string): Promise<string> {
  const res = await call(base, '/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  const token = (res.body as { access_token?: unknown } | null)?.access_token;
  if (res.status !== 200 || typeof token !== 'string') {
    throw new Error(`login failed: ${res.status}`);
  }
  return token;
}

/** Runs `tasks` with at most `width` in flight. */
export async function pooled<T>(
  width: number,
  tasks: Array<() => Promise<T>>,
): Promise<T[]> {
  const out: T[] = new Array<T>(tasks.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(width, tasks.length) }, lane),
  );
  return out;
}
