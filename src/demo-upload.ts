import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
import {
  asBody,
  bareEnv,
  redact,
  sleep,
  spawnNode,
  waitPortClosed,
} from './demo-proc';
import { headObjectStatus, resetBucket } from './storage/bucket';
import {
  createStorageClient,
  requireStorageConfig,
  type StorageConfig,
} from './storage/client';
import { demoPng } from './storage/content-types';
import { PRESIGN_TTL_SEC } from './storage/limits';

const HOSTILE = '../../etc/passwd';
const INTENT_PORT = 18026;
const COMMIT_PORT = 18027;

type IntentBody = {
  id?: string;
  key?: string;
  url?: string;
  expiresIn?: number;
};

async function cleanHw26(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM files`);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [
    'hw26-%@shop.test',
  ]);
}

async function insertHw26(pool: Pool): Promise<{ id: string; email: string }> {
  const email = `hw26-upload-${randomUUID()}@shop.test`;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, balance, role, password_hash)
     VALUES ($1, 'hw26', 0, 'buyer', $2)
     RETURNING id`,
    [email, passwordHash],
  );
  return { id: String(result.rows[0].id), email };
}

function asIntent(body: unknown): { id: string; key: string; url: string } {
  const row = (body ?? {}) as IntentBody;
  if (
    typeof row.id !== 'string' ||
    typeof row.key !== 'string' ||
    typeof row.url !== 'string'
  ) {
    throw new Error('intent response has no presigned url');
  }
  if (row.expiresIn !== PRESIGN_TTL_SEC) {
    throw new Error(
      `presigned ttl is ${row.expiresIn}, want ${PRESIGN_TTL_SEC}`,
    );
  }
  const signedFor = new URL(row.url).searchParams.get('X-Amz-Expires');
  if (signedFor !== String(PRESIGN_TTL_SEC)) {
    throw new Error(`presigned URL is not signed for ${PRESIGN_TTL_SEC}s`);
  }
  return { id: row.id, key: row.key, url: row.url };
}

function keyFromServer(key: string, userId: string): number {
  if (['etc', 'passwd', '..'].some((piece) => key.includes(piece))) {
    return 0;
  }
  const shaped = new RegExp(
    `^uploads/${userId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png$`,
  );
  return shaped.test(key) ? 1 : 0;
}

function tamperKey(raw: string): string {
  const url = new URL(raw);
  const parts = url.pathname.split('/');
  const last = parts[parts.length - 1] ?? 'key';
  parts[parts.length - 1] = last.startsWith('x') ? `y${last}` : `x${last}`;
  url.pathname = parts.join('/');
  return url.toString();
}

async function httpPut(url: string, body: Buffer): Promise<number> {
  const res = await fetch(url, {
    method: 'PUT',
    body: asBody(body),
    redirect: 'manual',
  });
  await res.arrayBuffer();
  return res.status;
}

async function scenario(
  pool: Pool,
  client: S3Client,
  storage: StorageConfig,
): Promise<Record<string, number>> {
  const png = demoPng();
  const user = await insertHw26(pool);

  const phase = await withApp(INTENT_PORT, async (base) => {
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
        contentType: 'image/png',
        size: png.length,
        filename: HOSTILE,
      },
    });
    if (intent.status !== 200) {
      throw new Error(`intent ${intent.status}`);
    }
    const signed = asIntent(intent.body);
    if (storage.endpoint) {
      const origin = new URL(signed.url).origin;
      if (origin !== new URL(storage.endpoint).origin) {
        throw new Error('presigned URL does not point at storage');
      }
    }

    const empty = await call(base, '/uploads/intent', {
      method: 'POST',
      token,
      headers: { 'idempotency-key': randomUUID() },
      body: {
        contentType: 'image/png',
        size: png.length,
        filename: HOSTILE,
      },
    });
    if (empty.status !== 200) {
      throw new Error(`empty intent ${empty.status}`);
    }
    const emptyId = asIntent(empty.body).id;
    const premature = await call(base, `/uploads/${emptyId}/commit`, {
      method: 'POST',
      token,
    });
    const tampered = await httpPut(tamperKey(signed.url), png);
    const probe = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: `demo/expired-${randomUUID()}`,
      }),
      { expiresIn: 1 },
    );
    await sleep(3000);
    const expiredStatus = await httpPut(probe, png);
    return {
      intent: intent.status,
      keyOk: keyFromServer(signed.key, user.id),
      commitWithout: premature.status,
      tampered,
      expired: expiredStatus,
      upload: { ...signed, token },
    };
  });

  const upload = phase.upload;
  const apiAlive = await waitPortClosed(INTENT_PORT);
  const offline = await spawnNode(
    join(__dirname, 'demo-upload-put.js'),
    [upload.url],
    bareEnv(),
    png,
  );
  if (offline.code !== 0) {
    throw new Error(`offline put failed: ${redact(offline.stderr)}`);
  }
  const putOffline = Number(offline.stdout.trim());

  let commit = 0;
  await withApp(COMMIT_PORT, async (base) => {
    const done = await call(base, `/uploads/${upload.id}/commit`, {
      method: 'POST',
      token: upload.token,
    });
    commit = done.status;
    if (done.status === 200) {
      const head = await headObjectStatus(client, storage.bucket, upload.key);
      if (head !== 200) {
        throw new Error(`object missing after commit (${head})`);
      }
    }
  });

  return {
    intent: phase.intent,
    'key-from-server': phase.keyOk,
    'api-alive': apiAlive,
    'put-offline': putOffline,
    commit,
    'commit-without-bytes': phase.commitWithout,
    tampered: phase.tampered,
    expired: phase.expired,
  };
}

function assertUpload(rows: Record<string, number>): void {
  const commitWithout = rows['commit-without-bytes'];
  const rest = { ...rows };
  delete rest['commit-without-bytes'];
  assertContract(rest, {
    intent: 200,
    'key-from-server': 1,
    'api-alive': 0,
    'put-offline': 200,
    commit: 200,
    tampered: 403,
    expired: 403,
  });
  if (commitWithout < 400 || commitWithout >= 500) {
    throw new Error(`commit-without-bytes: got ${commitWithout} want 4xx`);
  }
}

async function main(): Promise<void> {
  const storage = requireStorageConfig();
  const client = createStorageClient(storage);
  const pool = openDemoPool();
  try {
    await resetBucket(client, storage.bucket);
    await cleanHw26(pool);
    const rows = await scenario(pool, client, storage);
    print(rows);
    assertUpload(rows);
  } finally {
    client.destroy();
    await cleanHw26(pool).catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
    });
    await pool.end();
  }
}

void main().catch(failDemo);
