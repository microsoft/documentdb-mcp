import express from 'express';
import { type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Server did not bind to a TCP port'));
                return;
            }
            resolve({
                url: `http://127.0.0.1:${address.port}`,
                close: () => closeServer(server),
            });
        });
        server.on('error', reject);
    });
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function createTestServer(env: NodeJS.ProcessEnv) {
    vi.resetModules();
    process.env = { ...originalEnv, ...env };
    const { createRateLimitMiddleware } = await import('../../src/security/rateLimit');
    const app = express();
    app.use(createRateLimitMiddleware());
    app.get('/test', (_req, res) => res.json({ ok: true }));
    return listen(app);
}

describe('rate limiting middleware', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    it('can be disabled for trusted local development', async () => {
        const server = await createTestServer({ RATE_LIMIT_ENABLED: 'false' });
        try {
            expect((await fetch(`${server.url}/test`)).status).toBe(200);
            expect((await fetch(`${server.url}/test`)).status).toBe(200);
        } finally {
            await server.close();
        }
    });

    it('returns 429 after the configured per-IP request limit', async () => {
        const server = await createTestServer({
            RATE_LIMIT_ENABLED: 'true',
            RATE_LIMIT_WINDOW_MS: '60000',
            RATE_LIMIT_MAX_REQUESTS: '1',
        });
        try {
            expect((await fetch(`${server.url}/test`)).status).toBe(200);
            const limitedResponse = await fetch(`${server.url}/test`);
            const body = await limitedResponse.json();

            expect(limitedResponse.status).toBe(429);
            expect(body.error.message).toBe('Too many requests. Please retry later.');
        } finally {
            await server.close();
        }
    });
});
