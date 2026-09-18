import path from 'node:path';
import {
  MatchersV3,
  PactV3,
  SpecificationVersion,
} from '@pact-foundation/pact';
import {
  PACT_CONSUMER,
  PACT_PROVIDER,
  PRODUCT_EXISTS_STATE,
} from './pact.constants';

const provider = new PactV3({
  consumer: PACT_CONSUMER,
  provider: PACT_PROVIDER,
  dir: path.resolve(process.cwd(), 'pacts'),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V3,
});

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
        headers: {
          'Content-Type': MatchersV3.regex(
            'application/json.*',
            'application/json; charset=utf-8',
          ),
        },
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
});
