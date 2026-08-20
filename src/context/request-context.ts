import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type RequestStore = {
    requestId: string;
};

const storage = new AsyncLocalStorage<RequestStore>();

export const requestContext = {
    /**
     * Everything started inside the callback — including code that resumes after
     * an `await` — sees the same store, so parallel requests never share state.
     */
    run<T>(store: RequestStore, callback: () => T): T {
        return storage.run(store, callback);
    },

    getStore(): RequestStore | undefined {
        return storage.getStore();
    },

    getRequestId(): string | undefined {
        return storage.getStore()?.requestId;
    },

    createStore(incomingRequestId?: string | string[]): RequestStore {
        const fromHeader = Array.isArray(incomingRequestId)
            ? incomingRequestId[0]
            : incomingRequestId;

        return { requestId: fromHeader?.trim() || randomUUID() };
    },
};
