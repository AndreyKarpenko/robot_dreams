import type { Server } from 'node:http';

export const AUTH_HEADERS = { Authorization: 'Bearer test' };

export async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind HTTP server');
    }

    return `http://127.0.0.1:${address.port}`;
}
