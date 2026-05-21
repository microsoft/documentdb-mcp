import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function resetEnv(overrides: NodeJS.ProcessEnv = {}) {
    vi.resetModules();
    process.env = {
        ...originalEnv,
        AUTH_REQUIRED: 'false',
        ENABLE_READ_TOOLS: 'true',
        ENABLE_WRITE_TOOLS: 'false',
        ENABLE_MANAGEMENT_TOOLS: 'false',
        CONNECTION_PROFILES: '{"dev":{"authMode":"connectionString","uri":"mongodb://localhost:27017","allowedRoles":["read","write","management"]}}',
        ...overrides,
    };
}

describe('withDbGuard', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('returns an MCP error when connection_profile is missing', async () => {
        resetEnv();
        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const handler = vi.fn();
        const guarded = withDbGuard({ toolName: 'find_documents', requiredRole: 'read' }, handler);

        const result = await guarded({ connection_profile: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('connection_profile is required');
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not connect when capability gates deny the tool', async () => {
        resetEnv();
        const withClient = vi.fn();
        vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient: withClient }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const guarded = withDbGuard({ toolName: 'insert_documents', requiredRole: 'write' }, vi.fn());

        const result = await guarded({ connection_profile: 'dev' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Write tools are disabled by default');
        expect(withClient).not.toHaveBeenCalled();
    });

    it('resolves the connection profile and invokes the handler after preflight authorization', async () => {
        resetEnv({ ENABLE_WRITE_TOOLS: 'true' });
        const fakeClient = { db: vi.fn() };
        const withClient = vi.fn(async (_connection: unknown, callback: (client: unknown) => unknown) =>
            callback(fakeClient),
        );
        vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient: withClient }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
        const guarded = withDbGuard({ toolName: 'insert_documents', requiredRole: 'write' }, handler);

        const result = await guarded({ connection_profile: 'dev' });

        expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
        expect(withClient).toHaveBeenCalledWith(
            {
                kind: 'connectionString',
                uri: 'mongodb://localhost:27017',
                appName: 'documentdb-mcp-server/0.1.0 tool/insert_documents',
            },
            expect.any(Function),
        );
        expect(handler).toHaveBeenCalledWith({ connection_profile: 'dev' }, fakeClient);
    });

    it('uses DEFAULT_CONNECTION_PROFILE for local stdio calls that omit connection_profile', async () => {
        resetEnv({ TRANSPORT: 'stdio', DEFAULT_CONNECTION_PROFILE: 'dev' });
        const fakeClient = { db: vi.fn() };
        const withClient = vi.fn(async (_connection: unknown, callback: (client: unknown) => unknown) =>
            callback(fakeClient),
        );
        vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient: withClient }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
        const guarded = withDbGuard({ toolName: 'find_documents', requiredRole: 'read' }, handler);

        const result = await guarded({});

        expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
        expect(handler).toHaveBeenCalledWith({ connection_profile: 'dev' }, fakeClient);
    });

    it('records stdio transport in audit events for local stdio calls', async () => {
        resetEnv({ TRANSPORT: 'stdio', DEFAULT_CONNECTION_PROFILE: 'dev' });
        const fakeClient = { db: vi.fn() };
        const withClient = vi.fn(async (_connection: unknown, callback: (client: unknown) => unknown) =>
            callback(fakeClient),
        );
        vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient: withClient }));
        const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const guarded = withDbGuard({ toolName: 'find_documents', requiredRole: 'read' }, async () => ({
            content: [{ type: 'text', text: 'ok' }],
        }));

        const result = await guarded({});

        expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
        const auditLine = stderr.mock.calls
            .map(([message]) => String(message))
            .find((message) => message.startsWith('[MCP-AUDIT] '));
        expect(auditLine).toBeDefined();
        const audit = JSON.parse(auditLine!.replace('[MCP-AUDIT] ', ''));
        expect(audit).toMatchObject({
            toolName: 'find_documents',
            decision: 'allow',
            connectionProfile: 'dev',
            transport: 'stdio',
        });
    });

    it('rate limits local stdio tool calls before opening a backend connection', async () => {
        resetEnv({
            TRANSPORT: 'stdio',
            DEFAULT_CONNECTION_PROFILE: 'dev',
            RATE_LIMIT_ENABLED: 'true',
            RATE_LIMIT_WINDOW_MS: '60000',
            RATE_LIMIT_MAX_REQUESTS: '1',
        });
        const fakeClient = { db: vi.fn() };
        const withClient = vi.fn(async (_connection: unknown, callback: (client: unknown) => unknown) =>
            callback(fakeClient),
        );
        vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient: withClient }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
        const guarded = withDbGuard({ toolName: 'find_documents', requiredRole: 'read' }, handler);

        expect(await guarded({})).toEqual({ content: [{ type: 'text', text: 'ok' }] });
        const limited = await guarded({});

        expect(limited.isError).toBe(true);
        expect(limited.content[0].text).toContain('Too many requests. Please retry later.');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(withClient).toHaveBeenCalledTimes(1);
    });

    it('uses the sole stdio profile as the default when DEFAULT_CONNECTION_PROFILE is unset', async () => {
        resetEnv({ TRANSPORT: 'stdio' });
        const fakeClient = { db: vi.fn() };
        const withClient = vi.fn(async (_connection: unknown, callback: (client: unknown) => unknown) =>
            callback(fakeClient),
        );
        vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient: withClient }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
        const guarded = withDbGuard({ toolName: 'find_documents', requiredRole: 'read' }, handler);

        const result = await guarded({});

        expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
        expect(handler).toHaveBeenCalledWith({ connection_profile: 'dev' }, fakeClient);
    });

    it('passes Entra profiles to the database client without requiring a connection string', async () => {
        resetEnv({
            CONNECTION_PROFILES:
                '{"prod":{"authMode":"entra","endpoint":"cluster.global.mongocluster.cosmos.azure.com","tokenScope":"https://example.azure.com/.default"}}',
        });
        const fakeClient = { db: vi.fn() };
        const withClient = vi.fn(async (_connection: unknown, callback: (client: unknown) => unknown) =>
            callback(fakeClient),
        );
        vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient: withClient }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { withDbGuard } = await import('../../src/tools/utils/dbGuard');
        const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
        const guarded = withDbGuard({ toolName: 'find_documents', requiredRole: 'read' }, handler);

        const result = await guarded({ connection_profile: 'prod' });

        expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
        expect(withClient).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'entra',
                uri: 'mongodb+srv://cluster.global.mongocluster.cosmos.azure.com/?tls=true',
                tokenScope: 'https://example.azure.com/.default',
                appName: 'documentdb-mcp-server/0.1.0 tool/find_documents',
            }),
            expect.any(Function),
        );
    });
});
