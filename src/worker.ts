import type { DataSource } from 'typeorm';
import { Job } from './entities/job.entity';

export const JOB_WORK_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claim one pending job with FOR UPDATE SKIP LOCKED, do the work while the
 * transaction (and row lock) is still open, then commit status=done together
 * with processed += 1. If this process dies before COMMIT, the lock vanishes
 * and another worker can take the row.
 */
export async function claimAndProcessJob(
  dataSource: DataSource,
  workerId: string,
  workMs = JOB_WORK_MS,
): Promise<boolean> {
  return dataSource.transaction(async (manager) => {
    const job = await manager
      .createQueryBuilder(Job, 'job')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('job.status = :status', { status: 'pending' })
      .orderBy('job.id', 'ASC')
      .limit(1)
      .getOne();

    if (!job) {
      return false;
    }

    await sleep(workMs);

    job.status = 'done';
    job.processed += 1;
    job.workerId = workerId;
    job.result = `handled by ${workerId}`;
    await manager.save(job);
    return true;
  });
}

/**
 * Drain pending jobs. An empty SKIP LOCKED result means "none free right now",
 * not "queue empty" — re-check pending count before the worker exits.
 */
export async function drainQueue(
  dataSource: DataSource,
  workerId: string,
  workMs = JOB_WORK_MS,
): Promise<number> {
  let handled = 0;
  let emptyStreak = 0;

  while (emptyStreak < 20) {
    const got = await claimAndProcessJob(dataSource, workerId, workMs);
    if (got) {
      handled += 1;
      emptyStreak = 0;
      continue;
    }

    const pending = await dataSource.getRepository(Job).count({
      where: { status: 'pending' },
    });
    if (pending === 0) {
      break;
    }
    emptyStreak += 1;
    await sleep(20);
  }

  return handled;
}
