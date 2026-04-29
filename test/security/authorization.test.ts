import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function resetEnv(overrides: NodeJS.ProcessEnv = {}) {
    vi.resetModules();
    process.env = {
        ...originalEnv,
        AUTH_REQUIRED: 'true',
        TRANSPORT: 'streamable-http',
        MCP_READ_ROLE_VALUES: 'DocumentDB.MCP.Read',
        MCP_WRITE_ROLE_VALUES: 'DocumentDB.MCP.Write',
        MCP_MANAGEMENT_ROLE_VALUES: 'DocumentDB.MCP.Management',
        ENABLE_READ_TOOLS: 'true',
        ENABLE_WRITE_TOOLS: 'false',
        ENABLE_MANAGEMENT_TOOLS: 'false',
        ...overrides,
    };
}

async function loadAuthorization() {
    const requestContext = await import('../../src/security/requestContext');
    const authorization = await import('../../src/security/authorization');
    return { requestContext, authorization };
}

describe('authorization', () => {
    beforeEach(() => {
        resetEnv();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('derives the highest configured role from caller claims', async () => {
        const { requestContext, authorization } = await loadAuthorization();

        requestContext.runWithRequestContext(
            {
                transport: 'streamable-http',
                principal: {
                    roles: ['DocumentDB.MCP.Write'],
                    groups: [],
                    scopes: [],
                },
            },
            () => {
                expect(authorization.getPrincipalEffectiveRole()).toBe('write');
                expect(() => authorization.assertAuthorized('read')).not.toThrow();
                expect(() => authorization.assertAuthorized('write')).not.toThrow();
                expect(() => authorization.assertAuthorized('management')).toThrow(/not authorized/);
            },
        );
    });

    it('uses groups and scopes as configured role claim sources', async () => {
        const { requestContext, authorization } = await loadAuthorization();

        requestContext.runWithRequestContext(
            {
                transport: 'streamable-http',
                principal: {
                    roles: [],
                    groups: ['DocumentDB.MCP.Management'],
                    scopes: ['DocumentDB.MCP.Read'],
                },
            },
            () => {
                expect(authorization.getPrincipalEffectiveRole()).toBe('management');
                expect(() => authorization.assertAuthorized('management')).not.toThrow();
            },
        );
    });

    it('keeps write and management capabilities disabled by default', async () => {
        const { authorization } = await loadAuthorization();

        expect(() => authorization.assertCapabilityEnabled('read')).not.toThrow();
        expect(() => authorization.assertCapabilityEnabled('write')).toThrow(/Write tools are disabled/);
        expect(() => authorization.assertCapabilityEnabled('management')).toThrow(/Management tools are disabled/);
    });

    it('allows explicitly enabled write and management capabilities', async () => {
        resetEnv({ ENABLE_WRITE_TOOLS: 'true', ENABLE_MANAGEMENT_TOOLS: 'true' });
        const { authorization } = await loadAuthorization();

        expect(() => authorization.assertCapabilityEnabled('write')).not.toThrow();
        expect(() => authorization.assertCapabilityEnabled('management')).not.toThrow();
    });
});
