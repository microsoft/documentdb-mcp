import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const minimalEnv: NodeJS.ProcessEnv = {
    AUTH_REQUIRED: 'false',
    CONNECTION_PROFILES: '{"dev":{"authMode":"connectionString","uri":"mongodb://localhost:27017"}}',
};

function setEnv(overrides: NodeJS.ProcessEnv = {}) {
    vi.resetModules();
    // Strip any env vars under test so prior overrides don't leak between cases.
    const cleaned = { ...originalEnv };
    for (const key of [
        'MAX_FIND_LIMIT',
        'MAX_SAMPLE_SIZE',
        'MAX_INSERT_BATCH_SIZE',
        'MAX_RETURN_BYTES',
        'MONGODB_MAX_TIME_MS',
        'DEFAULT_CONNECTION_PROFILE',
    ]) {
        delete cleaned[key];
    }
    process.env = { ...cleaned, ...minimalEnv, ...overrides };
}

async function loadConfig() {
    const mod = await import('../src/config');
    return mod.config;
}

describe('config.limits', () => {
    beforeEach(() => setEnv());

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    it('uses documented defaults when env vars are unset', async () => {
        const cfg = await loadConfig();
        expect(cfg.limits).toEqual({
            maxFindLimit: 100,
            maxSampleSize: 50,
            maxInsertBatchSize: 100,
            maxReturnBytes: 1_048_576,
            mongoMaxTimeMs: 30_000,
        });
    });

    it('accepts admin overrides at or below the documented backend hard caps', async () => {
        setEnv({
            MAX_FIND_LIMIT: '10000',
            MAX_SAMPLE_SIZE: '10000',
            MAX_INSERT_BATCH_SIZE: '25000',
            MAX_RETURN_BYTES: String(48 * 1024 * 1024),
            MONGODB_MAX_TIME_MS: '600000',
        });
        const cfg = await loadConfig();
        expect(cfg.limits.maxFindLimit).toBe(10_000);
        expect(cfg.limits.maxSampleSize).toBe(10_000);
        expect(cfg.limits.maxInsertBatchSize).toBe(25_000);
        expect(cfg.limits.maxReturnBytes).toBe(48 * 1024 * 1024);
        expect(cfg.limits.mongoMaxTimeMs).toBe(600_000);
    });

    it('rejects MAX_INSERT_BATCH_SIZE above the DocumentDB 25,000-write batch ceiling', async () => {
        setEnv({ MAX_INSERT_BATCH_SIZE: '25001' });
        await expect(loadConfig()).rejects.toThrow(/MAX_INSERT_BATCH_SIZE=25001 exceeds.*25000/);
    });

    it('rejects MAX_RETURN_BYTES above the 48 MiB wire-protocol message ceiling', async () => {
        setEnv({ MAX_RETURN_BYTES: String(48 * 1024 * 1024 + 1) });
        await expect(loadConfig()).rejects.toThrow(/MAX_RETURN_BYTES=\d+ exceeds.*\d+/);
    });

    it('rejects MAX_FIND_LIMIT above 10,000', async () => {
        setEnv({ MAX_FIND_LIMIT: '10001' });
        await expect(loadConfig()).rejects.toThrow(/MAX_FIND_LIMIT=10001 exceeds.*10000/);
    });

    it('rejects MAX_SAMPLE_SIZE above 10,000', async () => {
        setEnv({ MAX_SAMPLE_SIZE: '10001' });
        await expect(loadConfig()).rejects.toThrow(/MAX_SAMPLE_SIZE=10001 exceeds.*10000/);
    });

    it('rejects MONGODB_MAX_TIME_MS above 600,000 (10 min)', async () => {
        setEnv({ MONGODB_MAX_TIME_MS: '600001' });
        await expect(loadConfig()).rejects.toThrow(/MONGODB_MAX_TIME_MS=600001 exceeds.*600000/);
    });

    it('rejects zero or negative limit values', async () => {
        setEnv({ MAX_FIND_LIMIT: '0' });
        await expect(loadConfig()).rejects.toThrow(/MAX_FIND_LIMIT must be a positive integer/);

        setEnv({ MAX_INSERT_BATCH_SIZE: '-5' });
        await expect(loadConfig()).rejects.toThrow(/MAX_INSERT_BATCH_SIZE must be a positive integer/);
    });

    it('rejects non-numeric limit values', async () => {
        setEnv({ MAX_RETURN_BYTES: 'abc' });
        await expect(loadConfig()).rejects.toThrow(/MAX_RETURN_BYTES must be a positive integer/);
    });
});

describe('config.defaultConnectionProfile', () => {
    beforeEach(() => setEnv());

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
    });

    it('reads DEFAULT_CONNECTION_PROFILE when set', async () => {
        setEnv({ DEFAULT_CONNECTION_PROFILE: 'dev' });

        const cfg = await loadConfig();

        expect(cfg.defaultConnectionProfile).toBe('dev');
    });
});
