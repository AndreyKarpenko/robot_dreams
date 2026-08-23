import { AsyncLocalStorage } from 'node:async_hooks';

type RequestStore = {
    requestId: string;
};

const storage = new AsyncLocalStorage<RequestStore>();

export function runWithRequestId<T>(requestId: string, callback: () => T): T {
    return storage.run({ requestId }, callback);
}

export function getRequestId(): string {
    const store = storage.getStore();

    if (!store) {
        throw new Error('Request context is not available');
    }

    return store.requestId;
}

export function findRequestId(): string | undefined {
    return storage.getStore()?.requestId;
}
