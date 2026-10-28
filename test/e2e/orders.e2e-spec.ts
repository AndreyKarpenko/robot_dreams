import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { hashPassword } from '../../src/auth/password';
import { ProductsRepository } from '../../src/products/products.repository';
import { UsersRepository } from '../../src/users/users.repository';
import { aProduct, aUser } from '../integration/testkit/builders';
import { startTestDb, TestDb } from '../integration/testkit/postgres';
import { createTestingApp } from './create-app';

type OrderBody = {
  id: number;
  status: string;
  total_cents: number;
  items: Array<{
    product_id: number;
    quantity: number;
    price_cents: number;
  }>;
};

const PASSWORD = 'e2e-password';

describe('Orders (e2e)', () => {
  let db: TestDb;
  let app: INestApplication<App>;
  let productId: number;
  let accessToken: string;

  beforeAll(async () => {
    db = await startTestDb();
    const users = new UsersRepository(db.pool);
    const products = new ProductsRepository(db.pool);
    const seller = await users.insert(aUser({ name: 'E2E Seller' }));
    const buyer = await users.insert({
      ...aUser({ name: 'E2E Buyer', balance: 1_000_000 }),
      passwordHash: await hashPassword(PASSWORD),
      role: 'buyer',
    });
    const product = await products.insert(
      aProduct({ sellerId: seller.id, price: 1299, stock: 20 }),
    );
    productId = Number(product.id);
    process.env.STREAM_TOKEN_SECRET ??= 'test-stream-token-secret';
    app = await createTestingApp();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: buyer.email, password: PASSWORD })
      .expect(200);
    accessToken = (login.body as { access_token: string }).access_token;
  }, 120000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await db?.stop();
  });

  it('creates an order and reads it back', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ items: [{ product_id: productId, quantity: 2 }] })
      .expect(201);

    const createdBody = created.body as OrderBody;
    expect(createdBody).toMatchObject({
      status: 'created',
      total_cents: 2598,
      items: [{ product_id: productId, quantity: 2, price_cents: 1299 }],
    });
    expect(createdBody.id).toEqual(expect.any(Number));

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${createdBody.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(fetched.body as OrderBody).toMatchObject({
      id: createdBody.id,
      status: 'created',
      total_cents: 2598,
      items: [{ product_id: productId, quantity: 2, price_cents: 1299 }],
    });
  });

  it('returns 400 from ValidationPipe when items are missing', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);
  });

  it('returns 404 for a missing order', async () => {
    await request(app.getHttpServer())
      .get('/orders/999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});
