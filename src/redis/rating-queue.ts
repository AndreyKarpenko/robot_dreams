import { Queue, Worker, type Job, type JobsOptions, type Processor } from 'bullmq';

export const RATING_QUEUE = 'hw23-ratings';
export const RATING_SCHEDULER = 'refresh-hot-cards';

export function ratingConnection(url: string, role: 'producer' | 'worker') {
  return {
    url,
    // The worker blocks on the queue. A finite retry count turns a blip into a crash.
    maxRetriesPerRequest: role === 'worker' ? null : 2,
  };
}

/** jobId dedups. removeOnComplete: true would forget the id and accept a second add. */
export function recalcJobOptions(productId: string): JobsOptions {
  return {
    jobId: `card-${productId}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 200, jitter: 0.2 },
    removeOnComplete: { age: 60 * 60 },
    removeOnFail: false,
  };
}

export function openRatingQueue(url: string): Queue {
  return new Queue(RATING_QUEUE, {
    connection: ratingConnection(url, 'producer'),
  });
}

export async function enqueueRatingRecalc(
  queue: Queue,
  productId: string,
): Promise<void> {
  await queue.add(
    'recalc-rating',
    { productId },
    recalcJobOptions(productId),
  );
}

/** Upsert, not add: a second boot updates the same scheduler instead of cloning it. */
export async function ensureRatingScheduler(
  queue: Queue,
  everyMs = 60_000,
): Promise<void> {
  await queue.upsertJobScheduler(
    RATING_SCHEDULER,
    { every: everyMs },
    {
      name: 'heartbeat',
      data: { kind: 'scheduled' },
      opts: { removeOnComplete: { age: 60 } },
    },
  );
}

export function startRatingWorker(
  url: string,
  processor: Processor,
): Worker {
  const worker = new Worker(RATING_QUEUE, processor, {
    connection: ratingConnection(url, 'worker'),
    concurrency: 4,
  });
  worker.on('error', (err: Error) => {
    console.error(`rating worker: ${err.message}`);
  });
  return worker;
}

export function isScheduledJob(job: Job): boolean {
  return job.name === 'heartbeat';
}
