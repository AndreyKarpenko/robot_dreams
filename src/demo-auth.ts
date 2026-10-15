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

const PORT = 18024;

async function main(): Promise<void> {
  const pool = openDemoPool();
  try {
    await cleanDemoUsers(pool);
    const user = await insertDemoUser(pool, 'buyer', 'auth');
    await withApp(PORT, async (base) => {
      const login = await call(base, '/auth/login', {
        method: 'POST',
        body: { email: user.email, password: DEMO_PASSWORD },
      });
      const session = login.status === 200 ? tokenPair(login.body) : null;
      const noToken = await call(base, '/auth/me');
      const withToken = await call(base, '/auth/me', {
        token: session?.access,
      });
      const refreshed = session
        ? await call(base, '/auth/refresh', {
            method: 'POST',
            body: { refresh_token: session.refresh },
          })
        : { status: 0, body: null };
      const rotated = refreshed.status === 200 ? tokenPair(refreshed.body) : null;
      const logout = rotated
        ? await call(base, '/auth/logout', {
            method: 'POST',
            token: rotated.access,
          })
        : { status: 0, body: null };
      const afterLogout = await call(base, '/auth/me', {
        token: rotated?.access,
      });
      const refreshAfterLogout = await call(base, '/auth/refresh', {
        method: 'POST',
        body: { refresh_token: rotated?.refresh ?? session?.refresh ?? '' },
      });

      const rows = {
        login: login.status,
        'no-token': noToken.status,
        'with-token': withToken.status,
        refresh: refreshed.status,
        logout: logout.status,
        'after-logout': afterLogout.status,
        'refresh-after-logout': refreshAfterLogout.status,
      };
      print(rows);
      assertContract(rows, {
        login: 200,
        'no-token': 401,
        'with-token': 200,
        refresh: 200,
        logout: 204,
        'after-logout': 401,
        'refresh-after-logout': 401,
      });
    });
  } finally {
    await cleanDemoUsers(pool);
    await pool.end();
  }
}

void main().catch(failDemo);
