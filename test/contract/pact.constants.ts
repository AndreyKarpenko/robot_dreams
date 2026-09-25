export const PACT_CONSUMER = 'MarketplaceWeb';
export const PACT_PROVIDER = 'MarketplaceAPI';
export const PACT_CONSUMER_VERSION =
  process.env.PACT_CONSUMER_VERSION ?? '1.0.0';
export const PACT_PROVIDER_VERSION =
  process.env.PACT_PROVIDER_VERSION ?? '1.0.0';
export const PRODUCT_EXISTS_STATE = 'a product with id 1 exists';
