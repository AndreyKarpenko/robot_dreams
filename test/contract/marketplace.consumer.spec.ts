import path from 'node:path';
import {
  MatchersV3,
  PactV3,
  SpecificationVersion,
} from '@pact-foundation/pact';
import {
  PACT_CONSUMER,
  PACT_PROVIDER,
  PRODUCT_AVAILABLE_TO_ORDER_STATE,
  PRODUCT_EXISTS_STATE,
} from './pact.constants';

const provider = new PactV3({
  consumer: PACT_CONSUMER,
  provider: PACT_PROVIDER,
  dir: path.resolve(process.cwd(), 'pacts'),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V3,
});

const jsonHeaders = {
  'Content-Type': MatchersV3.regex(
    'application/json.*',
    'application/json; charset=utf-8',
  ),
};

describe('MarketplaceWeb consumer', () => {
  it('gets a product by id', async () => {
    provider
      .given(PRODUCT_EXISTS_STATE)
      .uponReceiving('a request for product 1')
      .withRequest({
        method: 'GET',
        path: '/products/1',
      })
      .willRespondWith({
        status: 200,
        headers: jsonHeaders,
        body: MatchersV3.like({
          id: 1,
          name: 'Ceramic mug',
          price_cents: 1299,
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/products/1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: number;
        name: string;
        price_cents: number;
      };
      expect(body).toMatchObject({
        id: 1,
        name: 'Ceramic mug',
        price_cents: 1299,
      });
    });
  });

  it('creates an order', async () => {
    provider
      .given(PRODUCT_AVAILABLE_TO_ORDER_STATE)
      .uponReceiving('a request to create an order for product 1')
      .withRequest({
        method: 'POST',
        path: '/orders',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          items: [{ product_id: 1, quantity: 1 }],
        },
      })
      .willRespondWith({
        status: 201,
        headers: jsonHeaders,
        body: MatchersV3.like({
          id: 1,
          status: 'created',
          total_cents: 1299,
          items: MatchersV3.eachLike({
            product_id: 1,
            quantity: 1,
            price_cents: 1299,
          }),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ product_id: 1, quantity: 1 }] }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: number;
        status: string;
        total_cents: number;
        items: Array<{
          product_id: number;
          quantity: number;
          price_cents: number;
        }>;
      };
      expect(body).toMatchObject({
        status: 'created',
        total_cents: 1299,
        items: [{ product_id: 1, quantity: 1, price_cents: 1299 }],
      });
      expect(body.id).toEqual(expect.any(Number));
    });
  });
});
