import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Queue, Worker } from 'bullmq';
import type { Pool } from 'pg';
import { abortIfAny } from '../storage/bucket';

export const UPLOAD_SWEEP_QUEUE = 'hw26-upload-sweep';
const STALE_AFTER = `interval '1 day'`;

type StaleRow = { id: string; key: string; upload_id: string | null };

/**
 * PENDING older than a day is an orphan: the client took an intent and never
 * committed. Abort the multipart upload (it is billed with no object), delete
 * any bytes, then drop the row.
 */
export async function sweepStaleUploads(
  pool: Pool,
  client: S3Client,
  bucket: string,
): Promise<number> {
  const result = await pool.query<StaleRow>(
    `SELECT id, key, upload_id
       FROM files
      WHERE status = 'PENDING'
        AND created_at < now() - ${STALE_AFTER}
      ORDER BY created_at
      LIMIT 100`,
  );
  let removed = 0;
  for (const row of result.rows) {
    await abortIfAny(client, bucket, row.key, row.upload_id);
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: row.key }),
    );
    await pool.query(`DELETE FROM files WHERE id = $1 AND status = 'PENDING'`, [
      row.id,
    ]);
    removed += 1;
  }
  return removed;
}

export async function startUploadSweep(
  redisUrl: string,
  run: () => Promise<void>,
): Promise<{ close: () => Promise<void> }> {
  const queue = new Queue(UPLOAD_SWEEP_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: 2 },
  });
  await queue.upsertJobScheduler(
    'sweep-pending',
    { every: 60 * 60 * 1000 },
    {
      name: 'sweep',
      data: {},
      opts: { removeOnComplete: { age: 60 * 60 } },
    },
  );
  const worker = new Worker(
    UPLOAD_SWEEP_QUEUE,
    async () => {
      await run();
    },
    { connection: { url: redisUrl, maxRetriesPerRequest: null } },
  );
  worker.on('error', (err) => {
    console.error(`upload sweep: ${err.message}`);
  });
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
