import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request facts the logger needs but no function signature should carry.
 * The correlator itself is not here: trace_id comes from the active span.
 */
export type RequestContext = {
  tenant: string;
  idempotencyKey?: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(store: RequestContext, fn: () => T): T {
    return storage.run(store, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  /** Fills in what is learned mid-request (the guard knows the user). */
  assign(patch: Partial<RequestContext>): void {
    const store = storage.getStore();
    if (store) {
      Object.assign(store, patch);
    }
  },
};
