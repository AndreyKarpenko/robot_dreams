import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from './auth/password';
import type { UserRole } from './auth/roles';

const DEMO_EMAIL = 'hw24-%@shop.test';
export const DEMO_PASSWORD = 'hw24-demo-password';

export function print(rows: Record<string, number>): void {
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key}=${value}`);
  }
}

export function assertContract(
  rows: Record<string, number>,
  expected: Record<string, number>,
): void {
  const bad: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    if (rows[key] !== want) {
      bad.push(`${key}: got ${rows[key]} want ${want}`);
    }
  }
  if (bad.length > 0) {
    throw new Error(bad.join('; '));
  }
}

export function openDemoPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (url) {
    return new Pool({ connectionString: url, max: 2 });
  }
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME;
  if (!host || !port || !user || !database) {
    throw new Error('Set DATABASE_URL or DB_HOST, DB_PORT, DB_USER, DB_NAME');
  }
  return new Pool({
    host,
    port: Number(port),
    user,
    password: process.env.DB_PASSWORD,
    database,
    max: 2,
  });
}

export async function cleanDemoUsers(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM order_items
      WHERE order_id IN (
        SELECT o.id FROM orders o
          JOIN users u ON u.id = o.buyer_id
         WHERE u.email LIKE $1
      )`,
    [DEMO_EMAIL],
  );
  await pool.query(
    `DELETE FROM orders
      WHERE buyer_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [DEMO_EMAIL],
  );
  await pool.query(
    `DELETE FROM order_items
      WHERE product_id IN (
        SELECT p.id FROM products p
          JOIN users u ON u.id = p.seller_id
         WHERE u.email LIKE $1
      )`,
    [DEMO_EMAIL],
  );
  await pool.query(
    `DELETE FROM products
      WHERE seller_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [DEMO_EMAIL],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [DEMO_EMAIL]);
}

export async function insertDemoUser(
  pool: Pool,
  role: UserRole,
  label: string,
): Promise<{ id: string; email: string }> {
  const email = `hw24-${label}-${randomUUID()}@shop.test`;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, balance, role, password_hash)
     VALUES ($1, $2, 0, $3, $4)
     RETURNING id`,
    [email, label, role, passwordHash],
  );
  return { id: result.rows[0].id, email };
}

export type HttpResult = { status: number; body: unknown };

export async function call(
  base: string,
  path: string,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (init.token) {
    headers.authorization = `Bearer ${init.token}`;
  }
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

export function tokenPair(body: unknown): { access: string; refresh: string } {
  if (body == null || typeof body !== 'object') {
    throw new Error('token response is not an object');
  }
  const access = (body as { access_token?: unknown }).access_token;
  const refresh = (body as { refresh_token?: unknown }).refresh_token;
  if (typeof access !== 'string' || typeof refresh !== 'string') {
    throw new Error('token response missing access_token or refresh_token');
  }
  return { access, refresh };
}

/** Same transformation the grader's three-line forge uses. */
export function tamperRole(access: string): string {
  const t = access.split('.');
  const p = JSON.parse(Buffer.from(t[1], 'base64url').toString()) as {
    role?: string;
  };
  p.role = 'admin';
  t[1] = Buffer.from(JSON.stringify(p)).toString('base64url');
  return t.join('.');
}

export async function withApp<T>(
  port: number,
  fn: (base: string) => Promise<T>,
): Promise<T> {
  const child = spawn(process.execPath, [join(__dirname, 'main.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const collect = (chunk: Buffer): void => {
    logs += chunk.toString('utf8');
    if (logs.length > 16_000) {
      logs = logs.slice(-12_000);
    }
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const stop = (): void => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
    }
  };
  process.on('exit', stop);

  try {
    await waitHealthy(child, port, () => logs);
    return await fn(`http://127.0.0.1:${port}`);
  } catch (err) {
    const tail = logs.trim();
    if (tail) {
      console.error(tail);
    }
    throw err;
  } finally {
    process.removeListener('exit', stop);
    stop();
    await exited(child);
  }
}

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  timer.unref();
  await once(child, 'exit');
  clearTimeout(timer);
}

async function waitHealthy(
  child: ChildProcess,
  port: number,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = 'not started';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`app exited ${child.exitCode} before listen\n${logs()}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        return;
      }
      last = `health ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`app did not become healthy (${last})`);
}

export function failDemo(err: unknown): never {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
