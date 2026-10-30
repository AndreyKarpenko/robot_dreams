import { createStorageClient, requireStorageConfig } from './storage/client';
import { openDemoPool } from './demo-harness';
import { startUploadSweep, sweepStaleUploads } from './uploads/sweep';

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_QUEUE_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_QUEUE_URL is required');
  }
  const storage = requireStorageConfig();
  const client = createStorageClient(storage);
  const pool = openDemoPool();
  const removed = await sweepStaleUploads(pool, client, storage.bucket);
  console.log(`swept=${removed}`);
  const sweep = await startUploadSweep(redisUrl, async () => {
    const n = await sweepStaleUploads(pool, client, storage.bucket);
    console.log(`swept=${n}`);
  });
  const shutdown = async (): Promise<void> => {
    await sweep.close();
    client.destroy();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
