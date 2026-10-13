import { Worker, type Job } from 'bullmq';
import { openRedis, readConfig } from './redis/client';
import {
  ensureRatingScheduler,
  isScheduledJob,
  openRatingQueue,
  RATING_SCHEDULER,
  recalcJobOptions,
  startRatingWorker,
} from './redis/rating-queue';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function print(rows: Record<string, number>): void {
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key}=${value}`);
  }
}

async function main(): Promise<void> {
  const url = required('REDIS_QUEUE_URL');
  const probe = openRedis(url, 'queue');
  const queue = openRatingQueue(url);
  const state = { attempts: 0, completed: 0, scheduledRuns: 0 };
  let worker: Worker | undefined;

  try {
    const policy = await readConfig(probe, 'maxmemory-policy');
    const existing = await queue.getJobSchedulers();
    for (const scheduler of existing) {
      await queue.removeJobScheduler(scheduler.id ?? scheduler.key);
    }
    await queue.obliterate({ force: true });

    const productId = `demo-${Date.now()}`;
    const options = recalcJobOptions(productId);
    await queue.add('recalc-rating', { productId }, options);
    await queue.add('recalc-rating', { productId }, options);
    const added = 2;
    const counts = await queue.getJobCounts(
      'waiting',
      'delayed',
      'active',
      'prioritized',
    );
    const queued =
      counts.waiting + counts.delayed + counts.active + counts.prioritized;

    await ensureRatingScheduler(queue, 300);
    const schedulers = await queue.getJobSchedulersCount();
    worker = startRatingWorker(url, async (job: Job) => {
      if (isScheduledJob(job)) {
        state.scheduledRuns += 1;
        return;
      }
      state.attempts += 1;
      if (state.attempts < 3) {
        throw new Error('rating backend unavailable');
      }
      state.completed += 1;
    });

    const deadline = Date.now() + 15_000;
    while (
      (state.completed < 1 || state.scheduledRuns < 2) &&
      Date.now() < deadline
    ) {
      await sleep(50);
    }

    const rows = {
      'queue-noeviction': policy === 'noeviction' ? 1 : 0,
      attempts: state.attempts,
      completed: state.completed,
      added,
      queued,
      schedulers,
      'scheduled-runs': state.scheduledRuns,
    };
    print(rows);
    if (
      rows['queue-noeviction'] !== 1 ||
      rows.attempts < 3 ||
      rows.completed !== 1 ||
      rows.added !== 2 ||
      rows.queued !== 1 ||
      rows.schedulers < 1 ||
      rows['scheduled-runs'] < 2
    ) {
      throw new Error(`queue demo outside the contract: ${JSON.stringify(rows)}`);
    }
  } finally {
    await worker?.close();
    await queue.removeJobScheduler(RATING_SCHEDULER).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await probe.quit();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
