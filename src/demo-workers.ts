import AppDataSource from './data-source';
import { Job } from './entities/job.entity';
import { drainQueue, JOB_WORK_MS } from './worker';

const WORKERS = 4;
const DEMO_JOBS = 16;

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const repo = AppDataSource.getRepository(Job);
    const rows = Array.from({ length: DEMO_JOBS }, (_, i) =>
      repo.create({
        kind: 'demo_work',
        payload: { n: i + 1 },
        status: 'pending',
        processed: 0,
      }),
    );
    await repo.save(rows);

    const pendingBefore = await repo.count({ where: { status: 'pending' } });
    const workerIds = Array.from(
      { length: WORKERS },
      (_, i) => `worker-${i + 1}`,
    );

    const started = Date.now();
    const handled = await Promise.all(
      workerIds.map((id) => drainQueue(AppDataSource, id, JOB_WORK_MS)),
    );
    const elapsedMs = Date.now() - started;

    const done = await repo.find({ where: { status: 'done' } });
    const processedTwice = done.filter((job) => job.processed > 1).length;
    const pendingLeft = await repo.count({ where: { status: 'pending' } });

    const distribution = workerIds.map((id, i) => `${id}: ${handled[i]}`);
    const sequentialMs = pendingBefore * JOB_WORK_MS;

    console.log(`воркерів: ${WORKERS}`);
    console.log(`задач у черзі (pending на старті): ${pendingBefore}`);
    console.log(`розподіл: ${distribution.join(', ')}`);
    console.log(`оброблено двічі: ${processedTwice}`);
    console.log(
      `час: ${elapsedMs} ms (послідовно було б ${sequentialMs} ms)`,
    );

    const workersUsed = handled.filter((n) => n > 0).length;
    const totalHandled = handled.reduce((sum, n) => sum + n, 0);

    if (processedTwice !== 0) {
      console.error('invariant failed: a job was processed more than once');
      process.exit(1);
    }
    if (pendingLeft !== 0) {
      console.error('invariant failed: pending jobs remain');
      process.exit(1);
    }
    if (workersUsed < 2) {
      console.error('invariant failed: need work on at least 2 workers');
      process.exit(1);
    }
    if (elapsedMs >= sequentialMs) {
      console.error('invariant failed: pool was not faster than sequential');
      process.exit(1);
    }
    if (totalHandled !== pendingBefore) {
      console.error(
        `invariant failed: handled ${totalHandled} != queued ${pendingBefore}`,
      );
      process.exit(1);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
