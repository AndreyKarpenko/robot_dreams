import AppDataSource from './data-source';
import { User } from './entities/user.entity';
import { postgresErrorCode, withRetry } from './retry';

const DELTA = 50;
const WORKERS = 2;
const EXPECTED = DELTA * WORKERS;

function makeBarrier(n: number): () => Promise<void> {
  let count = 0;
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    count += 1;
    if (count >= n) {
      release?.();
    }
    await opened;
  };
}

async function addBalanceRepeatableRead(
  userId: string,
  delta: number,
  afterRead?: () => Promise<void>,
): Promise<void> {
  await AppDataSource.transaction('REPEATABLE READ', async (manager) => {
    const rows: Array<{ balance: number }> = await manager.query(
      `SELECT balance FROM users WHERE id = $1`,
      [userId],
    );
    if (rows.length === 0) {
      throw new Error(`user ${userId} not found`);
    }
    if (afterRead) {
      await afterRead();
    }
    const next = Number(rows[0].balance) + delta;
    await manager.query(`UPDATE users SET balance = $1 WHERE id = $2`, [
      next,
      userId,
    ]);
  });
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const buyer = await AppDataSource.getRepository(User).findOne({
      where: { email: 'buyer.daria@shop.test' },
    });
    if (!buyer) {
      throw new Error('Seed buyer Daria is missing. Run npm run seed first.');
    }

    await AppDataSource.query(`UPDATE users SET balance = 0 WHERE id = $1`, [
      buyer.id,
    ]);

    const barrier = makeBarrier(WORKERS);
    const retries: Array<{ code: string; attempt: number }> = [];

    const runOne = async (): Promise<void> => {
      let waitForPeer = true;
      await withRetry(
        async () => {
          const afterRead = waitForPeer
            ? async () => {
                waitForPeer = false;
                await barrier();
              }
            : undefined;
          await addBalanceRepeatableRead(buyer.id, DELTA, afterRead);
        },
        {
          onRetry: ({ code, attempt }) => {
            retries.push({ code, attempt });
            console.log(`caught ${code}, retry attempt ${attempt}`);
          },
        },
      );
    };

    await Promise.all(Array.from({ length: WORKERS }, () => runOne()));

    const [{ balance }] = (await AppDataSource.query(
      `SELECT balance FROM users WHERE id = $1`,
      [buyer.id],
    )) as Array<{ balance: number }>;
    const finalBalance = Number(balance);

    console.log(`retries: ${retries.length}`);
    console.log(`фінальний баланс: ${finalBalance} (очікувано ${EXPECTED})`);

    if (retries.length < 1) {
      console.error('expected at least one 40001/40P01 retry');
      process.exit(1);
    }
    if (finalBalance !== EXPECTED) {
      console.error('invariant failed: lost update');
      process.exit(1);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  const code = postgresErrorCode(err);
  if (code) {
    console.error(`postgres code: ${code}`);
  }
  process.exit(1);
});
