import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
    'TRANSPORT',
    'HOST',
    'PORT',
    'AUTH_REQUIRED',
    'ENTRA_TENANT_ID',
    'ENTRA_AUDIENCE',
    'ENTRA_CLIENT_ID',
    'RATE_LIMIT_ENABLED',
    'RATE_LIMIT_WINDOW_MS',
    'RATE_LIMIT_MAX_REQUESTS',
    'MCP_READ_ROLE_VALUES',
    'MCP_WRITE_ROLE_VALUES',
    'MCP_MANAGEMENT_ROLE_VALUES',
    'ENABLE_READ_TOOLS',
    'ENABLE_WRITE_TOOLS',
    'ENABLE_MANAGEMENT_TOOLS',
    'ALLOW_AGGREGATE_WRITE_STAGES',
    'ALLOW_UNAUTHENTICATED_STDIO',
    'CONNECTION_PROFILES',
    'CONNECTION_PROFILES_FILE',
    'DOCUMENTDB_MCP_CONNECTION_STRING',
];

const savedEnv: Record<string, string | undefined> = {};
let savedArgv: string[];

function clearTargetEnv(): void {
    for (const key of ENV_KEYS) {
        delete process.env[key];
    }
}

async function loadFreshConfig(argv: string[] = []): Promise<typeof import('../../src/config').config> {
    process.argv = ['node', '/fake/main.js', ...argv];
    vi.resetModules();
    const module = await import('../../src/config');
    return module.config;
}

describe('config loader', () => {
    beforeEach(() => {
        for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
        savedArgv = process.argv;
        clearTargetEnv();
    });

    afterEach(() => {
        clearTargetEnv();
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        process.argv = savedArgv;
    });

    it('synthesizes a default profile from DOCUMENTDB_MCP_CONNECTION_STRING when no profiles are configured', async () => {
        process.env.DOCUMENTDB_MCP_CONNECTION_STRING = 'mongodb://localhost:27017/myDatabase';
        const config = await loadFreshConfig();
        expect(config.connectionProfiles).toEqual({
            default: { authMode: 'connectionString', uri: 'mongodb://localhost:27017/myDatabase' },
        });
    });

    it('does not synthesize a default profile when CONNECTION_PROFILES is set', async () => {
        process.env.CONNECTION_PROFILES = JSON.stringify({
            sandbox: { authMode: 'connectionString', uri: 'mongodb://existing:27017' },
        });
        process.env.DOCUMENTDB_MCP_CONNECTION_STRING = 'mongodb://localhost:27017/myDatabase';
        const config = await loadFreshConfig();
        expect(config.connectionProfiles).toEqual({
            sandbox: { authMode: 'connectionString', uri: 'mongodb://existing:27017' },
        });
        expect(config.connectionProfiles.default).toBeUndefined();
    });

    it('rejects DOCUMENTDB_MCP_CONNECTION_STRING values that are not Mongo URIs', async () => {
        process.env.DOCUMENTDB_MCP_CONNECTION_STRING = 'http://not-mongo';
        await expect(loadFreshConfig()).rejects.toThrow(/must start with 'mongodb:/);
    });

    it('--read-only forces all write capabilities off even if envs say otherwise', async () => {
        process.env.ENABLE_WRITE_TOOLS = 'true';
        process.env.ENABLE_MANAGEMENT_TOOLS = 'true';
        process.env.ALLOW_AGGREGATE_WRITE_STAGES = 'true';
        const config = await loadFreshConfig(['--read-only']);
        expect(config.capabilities.writeTools).toBe(false);
        expect(config.capabilities.managementTools).toBe(false);
        expect(config.capabilities.allowWriteStagesInAggregate).toBe(false);
    });

    it('--stdio sets stdio transport, disables auth, and allows unauthenticated stdio by default', async () => {
        const config = await loadFreshConfig(['--stdio']);
        expect(config.transport).toBe('stdio');
        expect(config.auth.required).toBe(false);
        expect(config.allowUnauthenticatedStdio).toBe(true);
    });

    it('--stdio is overridable: AUTH_REQUIRED=true is honored even with --stdio', async () => {
        process.env.AUTH_REQUIRED = 'true';
        const config = await loadFreshConfig(['--stdio']);
        expect(config.transport).toBe('stdio');
        expect(config.auth.required).toBe(true);
    });

    it('does not log the connection string itself when synthesizing default profile', async () => {
        const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        process.env.DOCUMENTDB_MCP_CONNECTION_STRING = 'mongodb://user:secret@host:27017/db';
        await loadFreshConfig();
        const messages = stderr.mock.calls.map((args) => args.join(' '));
        const synthesisLog = messages.find((m) => m.includes('synthesized'));
        expect(synthesisLog).toBeDefined();
        expect(synthesisLog).not.toContain('secret');
        expect(synthesisLog).not.toContain('mongodb://');
        stderr.mockRestore();
    });
});
