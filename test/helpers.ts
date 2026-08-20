import type { AddressInfo } from 'node:net';

import { createApp, type App, type AppOptions } from '../src/app';

export type TestApp = App & {
    baseUrl: string;
    /** Everything the framework logged during the test. */
    logs: string[];
    close(): Promise<void>;
};

export async function startApp(options: AppOptions = {}): Promise<TestApp> {
    const logs: string[] = [];
    const app = createApp({ logger: (message) => logs.push(message), ...options });

    await new Promise<void>((resolve) => {
        app.server.listen(0, '127.0.0.1', resolve);
    });

    const address = app.server.address() as AddressInfo | null;

    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind HTTP server');
    }

    return {
        ...app,
        baseUrl: `http://127.0.0.1:${address.port}`,
        logs,
        close: () =>
            new Promise<void>((resolve, reject) => {
                app.server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
