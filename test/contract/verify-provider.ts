import { Server } from 'node:http';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';
import type { VerifierOptions } from '@pact-foundation/pact';
import { Pool } from 'pg';
import { PG_POOL } from '../../src/db/database.module';
import { createTestingApp } from '../e2e/create-app';
import { startTestDb, TestDb } from '../integration/testkit/postgres';
import {
  PACT_CONSUMER,
  PACT_PROVIDER,
  PACT_PROVIDER_VERSION,
  PRODUCT_AVAILABLE_TO_ORDER_STATE,
  PRODUCT_EXISTS_STATE,
} from './pact.constants';

async function seedProductOne(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, name, balance)
     OVERRIDING SYSTEM VALUE
     VALUES (1, 'seller.pact@shop.test', 'Pact Seller', 0)
     ON CONFLICT ((lower(email))) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO products (id, name, price, stock, seller_id)
     OVERRIDING SYSTEM VALUE
     VALUES (1, 'Ceramic mug', 1299, 10, 1)
     ON CONFLICT (id) DO NOTHING`,
  );
}

export async function verifyProvider(): Promise<void> {
  const db: TestDb = await startTestDb();
  process.env.DEFAULT_BUYER_ID ??= '1';
  let app: INestApplication | undefined;
  try {
    app = await createTestingApp();
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP listen address');
    }
    const providerBaseUrl = `http://127.0.0.1:${address.port}`;
    const pool = app.get<Pool>(PG_POOL);
    const brokerUrl = process.env.PACT_BROKER_URL;
    const brokerToken = process.env.PACT_BROKER_TOKEN;

    const options: VerifierOptions = {
      provider: PACT_PROVIDER,
      providerBaseUrl,
      providerVersion: PACT_PROVIDER_VERSION,
      logLevel: 'info',
      stateHandlers: {
        [PRODUCT_EXISTS_STATE]: async () => {
          await seedProductOne(pool);
        },
        [PRODUCT_AVAILABLE_TO_ORDER_STATE]: async () => {
          await seedProductOne(pool);
          await pool.query(
            `UPDATE users SET balance = GREATEST(balance, 1000000) WHERE id = 1`,
          );
        },
      },
    };

    if (brokerUrl) {
      options.pactBrokerUrl = brokerUrl;
      options.publishVerificationResult = true;
      options.consumerVersionSelectors = [
        { consumer: PACT_CONSUMER, latest: true },
      ];
      if (brokerToken) {
        options.pactBrokerToken = brokerToken;
      }
    } else {
      options.pactUrls = [
        path.resolve(
          process.cwd(),
          'pacts',
          `${PACT_CONSUMER}-${PACT_PROVIDER}.json`,
        ),
      ];
    }

    await new Verifier(options).verifyProvider();
  } finally {
    if (app) {
      await app.close();
    }
    await db.stop();
  }
}
