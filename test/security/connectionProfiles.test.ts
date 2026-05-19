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

        expect(resolveConnectionProfile('dev')).toEqual({
            kind: 'connectionString',
            uri: 'mongodb://localhost:27017/dev',
            appName: undefined,
        });
    });

    it('resolves inline profile URIs', async () => {
        const { resolveConnectionProfile } = await loadProfiles('{"local":{"uri":"mongodb://localhost:27017/local"}}');

        expect(resolveConnectionProfile('local')).toEqual({
            kind: 'connectionString',
            uri: 'mongodb://localhost:27017/local',
            appName: undefined,
        });
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

describe('connectionProfiles — per-profile resource allowlists', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('allows any database when allowedDatabases is omitted', async () => {
        const { assertResourceAllowed } = await loadProfiles('{"dev":{"uri":"mongodb://fake"}}');

        expect(() => assertResourceAllowed('dev', { dbName: 'anything' })).not.toThrow();
    });

    it('allows a database listed in allowedDatabases', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet","ops"]}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet' })).not.toThrow();
        expect(() => assertResourceAllowed('dev', { dbName: 'ops' })).not.toThrow();
    });

    it('rejects a database not listed in allowedDatabases', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"]}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'secrets' })).toThrow(/Database 'secrets' is not allowed/);
    });

    it('treats an empty allowedDatabases array as explicit deny-all', async () => {
        const { assertResourceAllowed } = await loadProfiles('{"dev":{"uri":"mongodb://fake","allowedDatabases":[]}}');

        expect(() => assertResourceAllowed('dev', { dbName: 'anything' })).toThrow(
            /Database 'anything' is not allowed.*Allowed databases: \(none\)\./,
        );
    });

    it('treats an empty allowedCollections[db] array as explicit deny-all for that db', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":[]}}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'vehicles' })).toThrow(
            /Collection 'fleet\.vehicles' is not allowed.*Allowed collections in 'fleet': \(none\)\./,
        );
    });

    it('allows any collection when allowedCollections[db] is omitted', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"]}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'anything' })).not.toThrow();
    });

    it('allows a collection listed in allowedCollections[db]', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'vehicles' })).not.toThrow();
    });

    it('rejects a collection not listed in allowedCollections[db]', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'secrets' })).toThrow(
            /Collection 'fleet\.secrets' is not allowed/,
        );
    });

    it('rejects collection access when its database itself is not allowed', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"]}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'other', collectionName: 'vehicles' })).toThrow(
            /Database 'other' is not allowed/,
        );
    });

    it('returns scope via getProfileScope', async () => {
        const { getProfileScope } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}',
        );

        expect(getProfileScope('dev')).toEqual({
            allowedDatabases: ['fleet'],
            allowedCollections: { fleet: ['vehicles'] },
        });
    });

    it('returns empty scope for unknown profile', async () => {
        const { getProfileScope } = await loadProfiles('{"dev":{"uri":"mongodb://fake"}}');

        expect(getProfileScope('missing')).toEqual({});
    });
});

describe('connectionProfiles — per-profile capability tier restrictions', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('defaults to read-only when allowedRoles is omitted', async () => {
        const { assertProfileCapabilityAllowed } = await loadProfiles('{"dev":{"uri":"mongodb://fake"}}');

        expect(() => assertProfileCapabilityAllowed('dev', 'read')).not.toThrow();
        expect(() => assertProfileCapabilityAllowed('dev', 'write')).toThrow(
            /Tool tier 'write' is not allowed for connection profile 'dev'\. Allowed tiers: read\./,
        );
        expect(() => assertProfileCapabilityAllowed('dev', 'management')).toThrow(
            /Tool tier 'management' is not allowed.*Allowed tiers: read\./,
        );
    });

    it('treats an empty allowedRoles array as explicit deny-all (no tiers, not even read)', async () => {
        const { assertProfileCapabilityAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedRoles":[]}}',
        );

        expect(() => assertProfileCapabilityAllowed('dev', 'read')).toThrow(
            /Tool tier 'read' is not allowed.*Allowed tiers: \(none\)\./,
        );
        expect(() => assertProfileCapabilityAllowed('dev', 'write')).toThrow(/Allowed tiers: \(none\)\./);
        expect(() => assertProfileCapabilityAllowed('dev', 'management')).toThrow(/Allowed tiers: \(none\)\./);
    });

    it('allows tiers listed in allowedRoles', async () => {
        const { assertProfileCapabilityAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write"]}}',
        );

        expect(() => assertProfileCapabilityAllowed('dev', 'read')).not.toThrow();
        expect(() => assertProfileCapabilityAllowed('dev', 'write')).not.toThrow();
    });

    it('rejects tiers not listed in allowedRoles', async () => {
        const { assertProfileCapabilityAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read"]}}',
        );

        expect(() => assertProfileCapabilityAllowed('dev', 'write')).toThrow(
            /Tool tier 'write' is not allowed for connection profile 'dev'/,
        );
        expect(() => assertProfileCapabilityAllowed('dev', 'management')).toThrow(
            /Tool tier 'management' is not allowed/,
        );
    });

    it('is a no-op for unknown profile (resolveConnectionProfile surfaces that)', async () => {
        const { assertProfileCapabilityAllowed } = await loadProfiles('{"dev":{"uri":"mongodb://fake"}}');

        expect(() => assertProfileCapabilityAllowed('missing', 'management')).not.toThrow();
    });
});

describe('connectionProfiles — per-profile resource denylists (deny wins)', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('rejects a database listed in deniedDatabases', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","deniedDatabases":["secrets"]}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'secrets' })).toThrow(
            /Database 'secrets' is denied for connection profile 'dev'\./,
        );
        expect(() => assertResourceAllowed('dev', { dbName: 'fleet' })).not.toThrow();
    });

    it('denylist wins over allowlist when both list the same database', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet","secrets"],"deniedDatabases":["secrets"]}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet' })).not.toThrow();
        expect(() => assertResourceAllowed('dev', { dbName: 'secrets' })).toThrow(/Database 'secrets' is denied/);
    });

    it('rejects a collection listed in deniedCollections[db]', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","deniedCollections":{"fleet":["audit_log"]}}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'audit_log' })).toThrow(
            /Collection 'fleet\.audit_log' is denied for connection profile 'dev'\./,
        );
        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'vehicles' })).not.toThrow();
    });

    it('collection denylist wins over collection allowlist', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","allowedCollections":{"fleet":["vehicles","audit_log"]},"deniedCollections":{"fleet":["audit_log"]}}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'vehicles' })).not.toThrow();
        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'audit_log' })).toThrow(
            /Collection 'fleet\.audit_log' is denied/,
        );
    });

    it('empty denylists are no-ops', async () => {
        const { assertResourceAllowed } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","deniedDatabases":[],"deniedCollections":{"fleet":[]}}}',
        );

        expect(() => assertResourceAllowed('dev', { dbName: 'fleet' })).not.toThrow();
        expect(() => assertResourceAllowed('dev', { dbName: 'fleet', collectionName: 'vehicles' })).not.toThrow();
    });

    it('exposes denylists via getProfileScope', async () => {
        const { getProfileScope } = await loadProfiles(
            '{"dev":{"uri":"mongodb://fake","deniedDatabases":["secrets"],"deniedCollections":{"fleet":["audit_log"]}}}',
        );

        expect(getProfileScope('dev')).toEqual({
            allowedDatabases: undefined,
            allowedCollections: undefined,
            deniedDatabases: ['secrets'],
            deniedCollections: { fleet: ['audit_log'] },
        });
    });
});
