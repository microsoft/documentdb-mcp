/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import express from 'express';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerHealthRoutes } from '../src/health';
import type { MCPConfig } from '../src/config';

function validCfg(): MCPConfig {
    return {
        transport: 'streamable-http',
        host: 'localhost',
        port: 8070,
        auth: { required: false, tenantId: '', audience: '' },
        rateLimit: { enabled: false, windowMs: 60_000, maxRequests: 120 },
        authorization: { readRoleValues: [], writeRoleValues: [], managementRoleValues: [] },
        capabilities: {
            readTools: true,
            writeTools: false,
            managementTools: false,
            allowWriteStagesInAggregate: false,
        },
        limits: {
            maxFindLimit: 100,
            maxSampleSize: 50,
            maxInsertBatchSize: 100,
            maxReturnBytes: 1_048_576,
            mongoMaxTimeMs: 30_000,
        },
        connectionProfiles: { dev: { uri: 'mongodb://localhost:27017' } },
        trustLocalStdio: true,
    } as MCPConfig;
}

function startServer(cfg: MCPConfig): Promise<{ port: number; close: () => Promise<void> }> {
    const app = express();
    registerHealthRoutes(app, cfg);
    // A catch-all to confirm health routes are matched before any other handler.
    app.use((_req, res) => res.status(401).json({ error: 'unauthorized' }));
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('failed to bind'));
                return;
            }
            resolve({
                port: addr.port,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}

interface Probe {
    status: number;
    body: any;
}

function get(port: number, path: string): Promise<Probe> {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let body: any = text;
                try {
                    body = JSON.parse(text);
                } catch {
                    // leave as text
                }
                resolve({ status: res.statusCode || 0, body });
            });
        });
        req.on('error', reject);
    });
}

describe('health endpoints', () => {
    describe('/healthz', () => {
        let h: { port: number; close: () => Promise<void> };
        beforeAll(async () => (h = await startServer(validCfg())));
        afterAll(async () => h.close());

        it('returns 200 ok', async () => {
            const res = await get(h.port, '/healthz');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ok' });
        });

        it('still returns 200 even when config would be invalid (liveness != readiness)', async () => {
            // Spin up a fresh server with invalid config and confirm /healthz still answers.
            const bad = await startServer({ ...validCfg(), transport: 'bogus' as any });
            try {
                const res = await get(bad.port, '/healthz');
                expect(res.status).toBe(200);
                expect(res.body).toEqual({ status: 'ok' });
            } finally {
                await bad.close();
            }
        });
    });

    describe('/readyz', () => {
        it('returns 200 ready when config is valid', async () => {
            const h = await startServer(validCfg());
            try {
                const res = await get(h.port, '/readyz');
                expect(res.status).toBe(200);
                expect(res.body).toEqual({ status: 'ready' });
            } finally {
                await h.close();
            }
        });

        it('returns 503 not_ready when config is invalid (and includes the validateConfig message)', async () => {
            const h = await startServer({ ...validCfg(), transport: 'bogus' as any, port: 0 });
            try {
                const res = await get(h.port, '/readyz');
                expect(res.status).toBe(503);
                expect(res.body.status).toBe('not_ready');
                expect(res.body.error).toMatch(/Invalid configuration/);
                expect(res.body.error).toMatch(/TRANSPORT='bogus'/);
            } finally {
                await h.close();
            }
        });
    });

    describe('mounting order', () => {
        it('health routes are reachable even when later middleware would reject', async () => {
            // The startServer helper's catch-all returns 401. Health routes must run first.
            const h = await startServer(validCfg());
            try {
                const health = await get(h.port, '/healthz');
                expect(health.status).toBe(200);
                const ready = await get(h.port, '/readyz');
                expect(ready.status).toBe(200);
                const other = await get(h.port, '/some-other-path');
                expect(other.status).toBe(401);
            } finally {
                await h.close();
            }
        });
    });
});
