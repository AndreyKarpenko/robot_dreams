import { verifyProvider } from './verify-provider';

describe('MarketplaceAPI provider', () => {
  it('satisfies the consumer contract', async () => {
    await verifyProvider();
  }, 180000);
});
