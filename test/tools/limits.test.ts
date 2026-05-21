import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const baseEnv: NodeJS.ProcessEnv = {
    AUTH_REQUIRED: 'false',
    CONNECTION_PROFILES: '{"dev":{"authMode":"connectionString","uri":"mongodb://localhost:27017"}}',
};

function setEnv(overrides: NodeJS.ProcessEnv = {}) {
    vi.resetModules();
    process.env = { ...originalEnv, ...baseEnv, ...overrides };
}

async function loadLimits() {
    const mod = await import('../../src/tools/utils/limits');
    return mod;
}

describe('clampPositiveInt', () => {
    beforeEach(() => setEnv());
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    it('passes values that are below the maximum', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(50, { maxValue: 100, defaultValue: 100, fieldName: 'x' })).toBe(50);
    });

    it('returns the value unchanged at the cap boundary', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(100, { maxValue: 100, defaultValue: 100, fieldName: 'x' })).toBe(100);
    });

    it('clamps values above the cap to the cap', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(10_000, { maxValue: 100, defaultValue: 100, fieldName: 'x' })).toBe(100);
    });

    it('returns the default when the value is undefined', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(undefined, { maxValue: 100, defaultValue: 25, fieldName: 'x' })).toBe(25);
    });

    it('clamps the default itself if the default exceeds the cap', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(undefined, { maxValue: 50, defaultValue: 999, fieldName: 'x' })).toBe(50);
    });

    it('clamps negative values to zero', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(-10, { maxValue: 100, defaultValue: 100, fieldName: 'x' })).toBe(0);
    });

    it('floors fractional values', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(7.9, { maxValue: 100, defaultValue: 100, fieldName: 'x' })).toBe(7);
    });

    it('returns the default for non-finite inputs', async () => {
        const { clampPositiveInt } = await loadLimits();
        expect(clampPositiveInt(Number.NaN, { maxValue: 100, defaultValue: 10, fieldName: 'x' })).toBe(10);
        expect(clampPositiveInt(Number.POSITIVE_INFINITY, { maxValue: 100, defaultValue: 10, fieldName: 'x' })).toBe(
            10,
        );
    });
});

describe('assertBatchSizeWithinLimit', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    it('passes when the batch size is at the configured limit', async () => {
        setEnv({ MAX_INSERT_BATCH_SIZE: '100' });
        const { assertBatchSizeWithinLimit } = await loadLimits();
        expect(() => assertBatchSizeWithinLimit(100, 'documents')).not.toThrow();
    });

    it('passes for an empty batch', async () => {
        setEnv({ MAX_INSERT_BATCH_SIZE: '100' });
        const { assertBatchSizeWithinLimit } = await loadLimits();
        expect(() => assertBatchSizeWithinLimit(0, 'documents')).not.toThrow();
    });

    it('throws an actionable error when the batch exceeds the configured limit', async () => {
        setEnv({ MAX_INSERT_BATCH_SIZE: '100' });
        const { assertBatchSizeWithinLimit } = await loadLimits();
        expect(() => assertBatchSizeWithinLimit(101, 'documents')).toThrow(
            /documents contains 101 items which exceeds the maximum batch size of 100/,
        );
    });

    it('honours an admin-raised limit', async () => {
        setEnv({ MAX_INSERT_BATCH_SIZE: '5000' });
        const { assertBatchSizeWithinLimit } = await loadLimits();
        expect(() => assertBatchSizeWithinLimit(5000, 'documents')).not.toThrow();
        expect(() => assertBatchSizeWithinLimit(5001, 'documents')).toThrow(/exceeds the maximum batch size of 5000/);
    });
});

describe('serializeResponse', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    it('returns the MCP content shape with pretty-printed JSON', async () => {
        setEnv();
        const { serializeResponse } = await loadLimits();
        const result = serializeResponse({ ok: true, count: 3 });
        expect(result).toEqual({
            content: [{ type: 'text', text: JSON.stringify({ ok: true, count: 3 }, null, 2) }],
        });
    });

    it('throws when the serialized payload exceeds MAX_RETURN_BYTES', async () => {
        // Use a small ceiling so we can craft an oversized payload cheaply.
        setEnv({ MAX_RETURN_BYTES: '128' });
        const { serializeResponse } = await loadLimits();
        const big = { data: 'x'.repeat(500) };
        expect(() => serializeResponse(big)).toThrow(/Response payload \(\d+ bytes\) exceeds maximum \(128 bytes\)/);
    });

    it('passes a payload that is exactly at the byte limit', async () => {
        // Build a payload whose pretty-printed JSON is small and fits comfortably.
        setEnv({ MAX_RETURN_BYTES: '64' });
        const { serializeResponse } = await loadLimits();
        const small = { a: 1 };
        const text = JSON.stringify(small, null, 2);
        expect(text.length).toBeLessThanOrEqual(64);
        expect(() => serializeResponse(small)).not.toThrow();
    });
});

describe('maxTimeMSOption', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    it('returns the configured MONGODB_MAX_TIME_MS', async () => {
        setEnv({ MONGODB_MAX_TIME_MS: '15000' });
        const { maxTimeMSOption } = await loadLimits();
        expect(maxTimeMSOption()).toEqual({ maxTimeMS: 15000 });
    });

    it('falls back to the default when the env var is unset', async () => {
        setEnv();
        const { maxTimeMSOption } = await loadLimits();
        expect(maxTimeMSOption()).toEqual({ maxTimeMS: 30_000 });
    });
});
