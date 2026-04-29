import { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';

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