import {
  assertContract,
  call,
  cleanDemoUsers,
  DEMO_PASSWORD,
  failDemo,
  insertDemoUser,
  openDemoPool,
  print,
  tokenPair,
  withApp,
} from './demo-harness';

const PORT = 18025;

async function main(): Promise<void> {
  const pool = openDemoPool();
  try {
    await cleanDemoUsers(pool);
    const user = await insertDemoUser(pool, 'buyer', 'reuse');
    await withApp(PORT, async (base) => {
      const login = await call(base, '/auth/login', {
        method: 'POST',
        body: { email: user.email, password: DEMO_PASSWORD },
      });
      const session = login.status === 200 ? tokenPair(login.body) : null;
      const first = session
        ? await call(base, '/auth/refresh', {
            method: 'POST',
            body: { refresh_token: session.refresh },
          })
        : { status: 0, body: null };
      const rotated = first.status === 200 ? tokenPair(first.body) : null;
      const reuse = session
        ? await call(base, '/auth/refresh', {
            method: 'POST',
            body: { refresh_token: session.refresh },
          })
        : { status: 0, body: null };
      const after = rotated
        ? await call(base, '/auth/refresh', {
            method: 'POST',
            body: { refresh_token: rotated.refresh },
          })
        : { status: 0, body: null };

      const rows = {
        login: login.status,
        'r1-refresh': first.status,
        'r1-reuse': reuse.status,
        'r2-after-reuse': after.status,
      };
      print(rows);
      assertContract(rows, {
        login: 200,
        'r1-refresh': 200,
        'r1-reuse': 401,
        'r2-after-reuse': 401,
      });
    });
  } finally {
    await cleanDemoUsers(pool);
    await pool.end();
  }
}

void main().catch(failDemo);
