/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Express, Request, Response } from 'express';
import { config, type MCPConfig } from './config';
import { validateConfig } from './security/configValidation';

/**
 * Mounts `/healthz` and `/readyz` operational probes on an Express app.
 *
 * - `GET /healthz` — liveness. Returns `200 {status:'ok'}` if the process is responding to HTTP.
 *   Never touches config or backends; safe at any frequency.
 * - `GET /readyz` — readiness. Re-runs `validateConfig` against the in-memory `config` and returns
 *   `200 {status:'ready'}` on success or `503 {status:'not_ready', error}` on failure. Does **not**
 *   open backend connections (per release-readiness §7: "Avoid connecting to every customer
 *   database on every readiness probe").
 *
 * Both routes are intentionally unauthenticated and not rate-limited — orchestration platforms
 * (Kubernetes, ACA, etc.) call them at constant frequency without bearer tokens. Mount these
 * routes **before** any auth or rate-limit middleware so they remain reachable when those layers
 * reject everything else.
 *
 * The optional `cfg` parameter exists for testing — production callers omit it and the live
 * `config` singleton is used.
 */
export function registerHealthRoutes(app: Express, cfg: MCPConfig = config): void {
    app.get('/healthz', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'ok' });
    });

    app.get('/readyz', (_req: Request, res: Response) => {
        try {
            validateConfig(cfg);
            res.status(200).json({ status: 'ready' });
        } catch (error) {
            res.status(503).json({
                status: 'not_ready',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
