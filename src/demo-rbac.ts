import {
  assertContract,
  call,
  cleanDemoUsers,
  DEMO_PASSWORD,
  failDemo,
  insertDemoUser,
  openDemoPool,
  print,
  tamperRole,
  tokenPair,
  withApp,
} from './demo-harness';

const PORT = 18026;

async function main(): Promise<void> {
  const pool = openDemoPool();
  try {
    await cleanDemoUsers(pool);
    const owner = await insertDemoUser(pool, 'buyer', 'rbac-owner');
    const stranger = await insertDemoUser(pool, 'buyer', 'rbac-other');
    const seller = await insertDemoUser(pool, 'seller', 'rbac-seller');
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (status, total, buyer_id)
       VALUES ('created', 0, $1)
       RETURNING id`,
      [owner.id],
    );
    const orderId = order.rows[0].id;

    await withApp(PORT, async (base) => {
      const ownerLogin = await call(base, '/auth/login', {
        method: 'POST',
        body: { email: owner.email, password: DEMO_PASSWORD },
      });
      const strangerLogin = await call(base, '/auth/login', {
        method: 'POST',
        body: { email: stranger.email, password: DEMO_PASSWORD },
      });
      const sellerLogin = await call(base, '/auth/login', {
        method: 'POST',
        body: { email: seller.email, password: DEMO_PASSWORD },
      });
      const ownerTokens =
        ownerLogin.status === 200 ? tokenPair(ownerLogin.body) : null;
      const strangerTokens =
        strangerLogin.status === 200 ? tokenPair(strangerLogin.body) : null;
      const sellerTokens =
        sellerLogin.status === 200 ? tokenPair(sellerLogin.body) : null;

      const anon = await call(base, `/orders/${orderId}`);
      const own = await call(base, `/orders/${orderId}`, {
        token: ownerTokens?.access,
      });
      const foreign = await call(base, `/orders/${orderId}`, {
        token: strangerTokens?.access,
      });
      const product = {
        name: 'HW24 mug',
        price_cents: 100,
      };
      const roleDenied = await call(base, '/products', {
        method: 'POST',
        token: ownerTokens?.access,
        body: product,
      });
      const roleAllowed = await call(base, '/products', {
        method: 'POST',
        token: sellerTokens?.access,
        body: product,
      });
      const tampered = await call(base, '/products', {
        method: 'POST',
        token: ownerTokens ? tamperRole(ownerTokens.access) : undefined,
        body: product,
      });

      const rows = {
        anon: anon.status,
        own: own.status,
        foreign: foreign.status,
        'role-denied': roleDenied.status,
        'role-allowed': roleAllowed.status,
        tampered: tampered.status,
      };
      print(rows);
      assertContract(rows, {
        anon: 401,
        own: 200,
        foreign: 403,
        'role-denied': 403,
        'role-allowed': 201,
        tampered: 401,
      });
    });
  } finally {
    await cleanDemoUsers(pool);
    await pool.end();
  }
}

void main().catch(failDemo);
