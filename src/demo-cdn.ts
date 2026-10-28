import { ASSET_CACHE_CONTROL, publishHashedAsset } from './cdn/publish';
import { startEdge } from './cdn/edge';
import { assertContract, failDemo, print } from './demo-harness';
import { resetBucket } from './storage/bucket';
import {
  createStorageClient,
  requireStorageConfig,
  type StorageConfig,
} from './storage/client';

const EDGE_PORT = 18032;

function directUrl(storage: StorageConfig, key: string): string {
  const encoded = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  if (storage.endpoint) {
    return `${storage.endpoint}/${encodeURIComponent(storage.bucket)}/${encoded}`;
  }
  return `https://${storage.bucket}.s3.${storage.region}.amazonaws.com/${encoded}`;
}

async function read(
  url: string,
): Promise<{
  status: number;
  body: Buffer;
  cache: string | null;
  cacheControl: string | null;
}> {
  const res = await fetch(url, { redirect: 'manual' });
  const body = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    body,
    cache: res.headers.get('x-cache'),
    cacheControl: res.headers.get('cache-control'),
  };
}

async function main(): Promise<void> {
  const storage = requireStorageConfig();
  const client = createStorageClient(storage);
  const edge = await startEdge({
    port: EDGE_PORT,
    client,
    bucket: storage.bucket,
  });
  try {
    await resetBucket(client, storage.bucket);
    const v1 = Buffer.from('body{color:#c0392b}\n');
    const v2 = Buffer.from('body{color:#1a7f4b}\n');
    const first = await publishHashedAsset(client, storage.bucket, v1);
    const direct = await read(directUrl(storage, first.key));
    const miss = await read(`${edge.url}/${first.key}`);
    const hit = await read(`${edge.url}/${first.key}`);
    if (miss.cache !== 'MISS') {
      throw new Error('first edge read was not a miss');
    }
    if (!miss.body.equals(v1) || !hit.body.equals(v1)) {
      throw new Error('edge returned the wrong body');
    }
    const cacheControl = miss.cacheControl ?? '';
    if (cacheControl !== ASSET_CACHE_CONTROL) {
      throw new Error(`cache-control is "${cacheControl}"`);
    }
    const second = await publishHashedAsset(client, storage.bucket, v2);
    const fresh = await read(`${edge.url}/${second.key}`);
    const still = await read(`${edge.url}/${first.key}`);
    if (!still.body.equals(v1)) {
      throw new Error('old url changed; the cache was invalidated');
    }
    const rows = {
      direct: direct.status,
      'edge-miss': miss.status,
      'edge-hit': hit.status,
      'cache-hit': hit.cache === 'HIT' ? 1 : 0,
      'new-name': first.key !== second.key ? 1 : 0,
      'new-url': fresh.status,
      'content-changed':
        fresh.body.equals(v2) && !fresh.body.equals(v1) ? 1 : 0,
    };
    print(rows);
    assertContract(rows, {
      direct: 403,
      'edge-miss': 200,
      'edge-hit': 200,
      'cache-hit': 1,
      'new-name': 1,
      'new-url': 200,
      'content-changed': 1,
    });
  } finally {
    await edge.close();
    client.destroy();
  }
}

void main().catch(failDemo);
