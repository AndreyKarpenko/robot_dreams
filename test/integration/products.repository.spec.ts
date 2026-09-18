import { Pool, PoolClient } from 'pg';
import { ProductsRepository } from '../../src/products/products.repository';
import { UsersRepository } from '../../src/users/users.repository';
import { aProduct, aUser } from './testkit/builders';
import { startTestDb, TestDb } from './testkit/postgres';

describe('ProductsRepository', () => {
  let db: TestDb;
  let pool: Pool;
  let client: PoolClient;
  let users: UsersRepository;
  let products: ProductsRepository;

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
    products = new ProductsRepository(client);
  });

  afterEach(async () => {
    if (!client) {
      return;
    }
    await client.query('ROLLBACK');
    client.release();
  });

  it('inserts a product and finds it by id', async () => {
    const seller = await users.insert(aUser());
    const created = await products.insert(
      aProduct({ sellerId: seller.id, name: 'Ceramic mug', price: 1299 }),
    );
    const found = await products.findById(created.id);
    expect(found).toMatchObject({
      id: created.id,
      name: 'Ceramic mug',
      price: 1299,
      seller_id: seller.id,
    });
  });

  it('rejects a missing seller_id with foreign key constraint 23503', async () => {
    await expect(
      products.insert(aProduct({ sellerId: '999999' })),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('loads a product with its seller via JOIN and aggregates price by seller', async () => {
    const seller = await users.insert(
      aUser({ email: 'seller.join@shop.test' }),
    );
    const mug = await products.insert(
      aProduct({ sellerId: seller.id, name: 'Ceramic mug', price: 1299 }),
    );
    await products.insert(
      aProduct({ sellerId: seller.id, name: 'Soy candle', price: 899 }),
    );

    const withSeller = await products.findByIdWithSeller(mug.id);
    expect(withSeller).toMatchObject({
      id: mug.id,
      name: 'Ceramic mug',
      seller_email: seller.email,
      seller_name: seller.name,
    });

    const stats = await products.statsBySeller(seller.id);
    expect(stats).toMatchObject({
      seller_id: seller.id,
      product_count: 2,
      price_sum: 2198,
    });
  });
});
