import { afterEach, describe, expect, it } from 'vitest';

import { UserController } from '../src/controllers/UserController';
import { Controller, Get } from '../src/decorators';
import { sleep, startApp, type TestApp } from './helpers';

@Controller('slow')
class SlowController {
    @Get()
    async read() {
        await sleep(30);
        return { ok: true };
    }
}

const DURATION_LINE = /(\d+(?:\.\d+)?) ?ms/;

describe('logging interceptor', () => {
    let app: TestApp;

    afterEach(async () => {
        await app.close();
    });

    it('logs the route and the duration in milliseconds', async () => {
        app = await startApp({ controllers: [UserController] });

        await fetch(`${app.baseUrl}/users/42`);

        const line = app.logs.find((entry) => entry.includes('GET /users/42'));

        expect(line).toBeDefined();
        expect(line).toMatch(DURATION_LINE);
    });

    it('measures the real handler duration', async () => {
        app = await startApp({ controllers: [SlowController] });

        await fetch(`${app.baseUrl}/slow`);

        const line = app.logs.find((entry) => entry.includes('GET /slow'));
        const duration = Number(line?.match(DURATION_LINE)?.[1]);

        expect(duration).toBeGreaterThanOrEqual(25);
    });

    it('still logs when the handler fails', async () => {
        app = await startApp({ controllers: [UserController] });

        await fetch(`${app.baseUrl}/users/999`);

        expect(app.logs.some((entry) => /GET \/users\/999 — \d/.test(entry))).toBe(true);
    });

    it('prefixes the log line with the current request id', async () => {
        app = await startApp({ controllers: [UserController] });

        await fetch(`${app.baseUrl}/users/1`, { headers: { 'X-Request-Id': 'timed-request' } });

        expect(app.logs.some((entry) => entry.startsWith('[timed-request] GET /users/1'))).toBe(
            true,
        );
    });
});
