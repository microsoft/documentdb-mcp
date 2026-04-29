import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadProfiles(connectionProfiles: string, envOverrides: NodeJS.ProcessEnv = {}) {
    vi.resetModules();
    process.env = {
        ...originalEnv,
        CONNECTION_PROFILES: connectionProfiles,
        ...envOverrides,
    };
    return import('../../src/security/connectionProfiles');
}

describe('connectionProfiles', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('resolves profiles from environment variable references', async () => {
        const { resolveConnectionProfile } = await loadProfiles('{"dev":{"uriEnv":"DOCUMENTDB_DEV_URI"}}', {
            DOCUMENTDB_DEV_URI: 'mongodb://localhost:27017/dev',
        });

        expect(resolveConnectionProfile('dev')).toEqual({ kind: 'connectionString', uri: 'mongodb://localhost:27017/dev' });
    });

    it('resolves inline profile URIs', async () => {
        const { resolveConnectionProfile } = await loadProfiles('{"local":{"uri":"mongodb://localhost:27017/local"}}');

        expect(resolveConnectionProfile('local')).toEqual({ kind: 'connectionString', uri: 'mongodb://localhost:27017/local' });
    });

    it('resolves Entra profiles without connection strings', async () => {
        const { resolveConnectionProfile } = await loadProfiles(
            '{"prod":{"authMode":"entra","endpoint":"cluster.global.mongocluster.cosmos.azure.com","tokenScope":"https://example.azure.com/.default","appName":"mcp-test"}}',
        );

        expect(resolveConnectionProfile('prod')).toEqual({
            kind: 'entra',
            uri: 'mongodb+srv://cluster.global.mongocluster.cosmos.azure.com/?tls=true',
            tokenScope: 'https://example.azure.com/.default',
            tokenResource: undefined,
            username: undefined,
            retryWrites: undefined,
            appName: 'mcp-test',
            allowedHosts: undefined,
        });
    });

    it('normalizes Entra token resources into Azure Identity scopes', async () => {
        const { resolveConnectionProfile } = await loadProfiles(
            '{"prod":{"authMode":"entra","uri":"mongodb+srv://cluster.example.com/","tokenResource":"https://example.azure.com"}}',
        );

        expect(resolveConnectionProfile('prod')).toMatchObject({
            kind: 'entra',
            uri: 'mongodb+srv://cluster.example.com/',
            tokenScope: 'https://example.azure.com/.default',
            tokenResource: 'https://example.azure.com',
        });
    });

    it('rejects unknown profiles', async () => {
        const { resolveConnectionProfile } = await loadProfiles('{"dev":{"uri":"mongodb://localhost:27017"}}');

        expect(() => resolveConnectionProfile('missing')).toThrow(/Unknown connection profile/);
    });

    it('rejects profiles that reference unset secret environment variables', async () => {
        const { resolveConnectionProfile } = await loadProfiles('{"prod":{"uriEnv":"DOCUMENTDB_PROD_URI"}}', {
            DOCUMENTDB_PROD_URI: '',
        });

        expect(() => resolveConnectionProfile('prod')).toThrow(/references unset environment variable/);
    });

    it('rejects Entra profiles without token scope information', async () => {
        const { resolveConnectionProfile } = await loadProfiles(
            '{"prod":{"authMode":"entra","endpoint":"cluster.global.mongocluster.cosmos.azure.com"}}',
        );

        expect(() => resolveConnectionProfile('prod')).toThrow(/must define tokenScope or tokenResource/);
    });
});
