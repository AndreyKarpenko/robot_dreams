import { createHash, randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { hashPassword } from './auth/password';
import {
  assertContract,
  call,
  DEMO_PASSWORD,
  failDemo,
  openDemoPool,
  print,
  tokenPair,
  withApp,
} from './demo-harness';
import { bareEnv, redact, spawnNode } from './demo-proc';
import {
  headObjectMeta,
  headObjectStatus,
  resetBucket,
} from './storage/bucket';
import { createStorageClient, requireStorageConfig } from './storage/client';
import { isMultipartEtag } from './storage/etag';
import { multipartDemoFile, partCountFor, partSizeFor } from './storage/limits';

const PORT = 18031;

type PartUrl = { partNumber: number; url: string };
type IntentBody = {
  id?: string;
  key?: string;
  partSize?: number;
  parts?: PartUrl[];
};

async function cleanHw26(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM files`);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [
    'hw26-%@shop.test',
  ]);
}

async function insertHw26(pool: Pool): Promise<{ id: string; email: string }> {
  const email = `hw26-multipart-${randomUUID()}@shop.test`;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, balance, role, password_hash)
     VALUES ($1, 'hw26', 0, 'buyer', $2)
     RETURNING id`,
    [email, passwordHash],
  );
  return { id: String(result.rows[0].id), email };
}

async function main(): Promise<void> {
  const storage = requireStorageConfig();
  const client = createStorageClient(storage);
  const pool = openDemoPool();
  const file = multipartDemoFile();
  const filePath = join(tmpdir(), `hw26-multipart-${process.pid}.bin`);
  writeFileSync(filePath, file);
  try {
    await resetBucket(client, storage.bucket);
    await cleanHw26(pool);
    if (partCountFor(file.length) !== 3) {
      throw new Error(
        `demo file is not 3 parts (${partCountFor(file.length)})`,
      );
    }
    const user = await insertHw26(pool);
    const rows = await withApp(PORT, async (base) => {
      const login = await call(base, '/auth/login', {
        method: 'POST',
        body: { email: user.email, password: DEMO_PASSWORD },
      });
      if (login.status !== 200) {
        throw new Error(`login ${login.status}`);
      }
      const token = tokenPair(login.body).access;
      const intent = await call(base, '/uploads/intent', {
        method: 'POST',
        token,
        headers: { 'idempotency-key': randomUUID() },
        body: {
          contentType: 'application/octet-stream',
          size: file.length,
        },
      });
      if (intent.status !== 200) {
        throw new Error(`intent ${intent.status}`);
      }
      const body = (intent.body ?? {}) as IntentBody;
      const parts = [...(body.parts ?? [])].sort(
        (a, b) => a.partNumber - b.partNumber,
      );
      if (
        typeof body.id !== 'string' ||
        typeof body.key !== 'string' ||
        body.partSize !== partSizeFor(file.length) ||
        parts.length !== 3
      ) {
        throw new Error('multipart intent did not plan 3 parts');
      }
      const worker = join(__dirname, 'demo-multipart-worker.js');
      const seeded = await spawnNode(
        worker,
        ['seed', filePath, String(body.partSize), parts[0].url, parts[1].url],
        bareEnv(),
      );
      if (seeded.code !== 0) {
        throw new Error(`seed exited ${seeded.code}: ${redact(seeded.stderr)}`);
      }
      const resumed = await spawnNode(
        worker,
        ['resume', filePath, String(body.partSize), base, body.id, token],
        bareEnv(),
      );
      if (resumed.code !== 0) {
        throw new Error(
          `resume exited ${resumed.code}: ${redact(resumed.stderr)}`,
        );
      }
      const resumedParts = Number(resumed.stdout.trim());
      const before = await headObjectStatus(client, storage.bucket, body.key);
      const complete = await call(base, `/uploads/${body.id}/commit`, {
        method: 'POST',
        token,
      });
      const meta =
        complete.status === 200
          ? await headObjectMeta(client, storage.bucket, body.key)
          : { size: -1, etag: '' };
      const md5 = createHash('md5').update(file).digest('hex');
      return {
        'head-before-complete': before,
        'resumed-parts': resumedParts,
        complete: complete.status,
        'size-match': meta.size === file.length ? 1 : 0,
        'etag-multipart': isMultipartEtag(meta.etag, 3, md5) ? 1 : 0,
      };
    });
    print(rows);
    assertContract(rows, {
      'head-before-complete': 404,
      'resumed-parts': 1,
      complete: 200,
      'size-match': 1,
      'etag-multipart': 1,
    });
  } finally {
    client.destroy();
    try {
      unlinkSync(filePath);
    } catch {
      // The temp file is already gone.
    }
    await cleanHw26(pool).catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
    });
    await pool.end();
  }
}

void main().catch(failDemo);
