import { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';

let stdioWindowStart = 0;
let stdioRequestCount = 0;

export function createRateLimitMiddleware(): RequestHandler {
    if (!config.rateLimit.enabled) {
        return (_req, _res, next) => next();
    }

    return rateLimit({
        windowMs: config.rateLimit.windowMs,
        limit: config.rateLimit.maxRequests,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: {
            jsonrpc: '2.0',
            error: {
                code: -32029,
                message: 'Too many requests. Please retry later.',
            },
            id: null,
        },
    });
}

export function assertStdioRateLimit(): void {
    if (!config.rateLimit.enabled || config.transport !== 'stdio') return;

    const now = Date.now();
    if (stdioWindowStart === 0 || now - stdioWindowStart >= config.rateLimit.windowMs) {
        stdioWindowStart = now;
        stdioRequestCount = 0;
    }

    stdioRequestCount += 1;
    if (stdioRequestCount > config.rateLimit.maxRequests) {
        throw new Error('Too many requests. Please retry later.');
    }
}
