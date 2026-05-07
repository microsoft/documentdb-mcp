/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { config } from '../../config';

/**
 * Clamp a positive integer to `maxValue`. If the input is undefined or invalid, return `defaultValue`
 * (which itself is clamped to `maxValue`).
 *
 * Used to cap user-requested page sizes / sample sizes so a single tool call cannot pull millions of
 * documents into memory.
 */
export function clampPositiveInt(
    value: number | undefined,
    opts: { maxValue: number; defaultValue: number; fieldName: string },
): number {
    const max = opts.maxValue;
    const defaulted = opts.defaultValue ?? max;
    const safeDefault = Math.min(Math.max(defaulted, 0), max);
    if (value === undefined || value === null || !Number.isFinite(value)) return safeDefault;
    if (value < 0) return 0;
    if (value > max) return max;
    return Math.floor(value);
}

/**
 * Reject when an inbound batch (e.g. insert_documents array) exceeds the configured maximum.
 * Fail-closed with a clear, actionable error.
 */
export function assertBatchSizeWithinLimit(actualSize: number, fieldName: string): void {
    const max = config.limits.maxInsertBatchSize;
    if (actualSize > max) {
        throw new Error(
            `${fieldName} contains ${actualSize} items which exceeds the maximum batch size of ${max}. ` +
                `Split the request into smaller batches or raise MAX_INSERT_BATCH_SIZE.`,
        );
    }
}

/**
 * Wrap a tool response payload as the MCP content shape and enforce MAX_RETURN_BYTES.
 *
 * Throws if the serialized JSON exceeds the configured maximum. This protects:
 *   - the MCP server process from holding multi-MB responses in memory
 *   - the calling LLM from context-window overflow / silent truncation
 *
 * Using this helper everywhere also gives every tool consistent serialization (pretty-printed JSON).
 */
export function serializeResponse(payload: unknown): { content: { type: 'text'; text: string }[] } {
    const text = JSON.stringify(payload, null, 2);
    const max = config.limits.maxReturnBytes;
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (byteLength > max) {
        throw new Error(
            `Response payload (${byteLength} bytes) exceeds maximum (${max} bytes). ` +
                `Reduce the page size, narrow the query/projection, or raise MAX_RETURN_BYTES.`,
        );
    }
    return { content: [{ type: 'text', text }] };
}

/**
 * Driver options carrying the configured server-side execution timeout.
 * Pass-through to MongoClient query operations (find, count, aggregate, findOneAndUpdate).
 *
 * `maxTimeMS` is enforced by the backend, not the client, so it caps blast radius even when the
 * caller has a long-running unindexed query.
 */
export function maxTimeMSOption(): { maxTimeMS: number } {
    return { maxTimeMS: config.limits.mongoMaxTimeMs };
}
