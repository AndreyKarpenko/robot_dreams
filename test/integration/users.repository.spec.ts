import { Pool, PoolClient } from 'pg';
import { UsersRepository } from '../../src/users/users.repository';
import { aUser } from './testkit/builders';
import { startTestDb, TestDb } from './testkit/postgres';

describe('UsersRepository', () => {
  let db: TestDb;
  let pool: Pool;
  let client: PoolClient;
  let users: UsersRepository;

  beforeAll(async () => {
    db = await startTestDb();
    pool = db.pool;
  }, 120000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    users = new UsersRepository(client);
  });

  afterEach(async () => {
    if (!client) {
      return;
    }
    await client.query('ROLLBACK');
    client.release();
  });

  it('inserts a user and finds them by email', async () => {
    const created = await users.insert(aUser({ name: 'Daria Buyer' }));
    const found = await users.findByEmail(created.email);
    expect(found).toMatchObject({
      id: created.id,
      email: created.email,
      name: 'Daria Buyer',
    });
  });

  it('rejects a duplicate email with unique constraint 23505', async () => {
    const user = aUser({ email: 'dup@shop.test' });
    await users.insert(user);
    await expect(users.insert(user)).rejects.toMatchObject({ code: '23505' });
  });

  it('upserts the same email with ON CONFLICT on lower(email)', async () => {
    const first = await users.upsertByEmail(
      aUser({ email: 'Anna@shop.test', name: 'Anna', balance: 1 }),
    );
    const second = await users.upsertByEmail({
      email: 'anna@shop.test',
      name: 'Anna Seller',
      balance: 500,
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Anna Seller');
    expect(second.balance).toBe(500);
    expect(await users.findByEmail('ANNA@shop.test')).toMatchObject({
      id: first.id,
      name: 'Anna Seller',
    });
  });
});
