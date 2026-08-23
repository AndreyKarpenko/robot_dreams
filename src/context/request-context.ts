import { AsyncLocalStorage } from 'node:async_hooks';

type RequestStore = {
    requestId: string;
};

const storage = new AsyncLocalStorage<RequestStore>();

export function run<T>(requestId: string, callback: () => T): T {
    return storage.run({ requestId }, callback);
}

export function getRequestId(): string {
    return storage.getStore()!.requestId;
}
