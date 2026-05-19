import { afterEach, describe, expect, it, vi } from 'vitest';

describe('withDocumentDBClient', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('creates a legacy connection-string MongoClient when requested', async () => {
        const connect = vi.fn(async () => undefined);
        const close = vi.fn(async () => undefined);
        const MongoClient = vi.fn(function (this: any, uri: string, options?: unknown) {
            this.uri = uri;
            this.options = options;
            this.connect = connect;
            this.close = close;
        });
        vi.doMock('mongodb', () => ({ MongoClient, AuthMechanism: { MONGODB_OIDC: 'MONGODB-OIDC' } }));
        vi.doMock('@azure/identity', () => ({ DefaultAzureCredential: vi.fn() }));

        const { withDocumentDBClient } = await import('../../src/context/documentdb');
        const result = await withDocumentDBClient(
            { kind: 'connectionString', uri: 'mongodb://localhost:27017' },
            async () => 'ok',
        );

        expect(result).toBe('ok');
        expect(MongoClient).toHaveBeenCalledWith('mongodb://localhost:27017');
        expect(connect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('passes appName for connection-string MongoClient telemetry when provided', async () => {
        const connect = vi.fn(async () => undefined);
        const close = vi.fn(async () => undefined);
        const MongoClient = vi.fn(function (this: any, uri: string, options?: unknown) {
            this.uri = uri;
            this.options = options;
            this.connect = connect;
            this.close = close;
        });
        vi.doMock('mongodb', () => ({ MongoClient, AuthMechanism: { MONGODB_OIDC: 'MONGODB-OIDC' } }));
        vi.doMock('@azure/identity', () => ({ DefaultAzureCredential: vi.fn() }));

        const { withDocumentDBClient } = await import('../../src/context/documentdb');
        await withDocumentDBClient(
            {
                kind: 'connectionString',
                uri: 'mongodb://localhost:27017',
                appName: 'documentdb-mcp-server/0.1.0 tool/find_documents',
            },
            async () => 'ok',
        );

        expect(MongoClient).toHaveBeenCalledWith('mongodb://localhost:27017', {
            appName: 'documentdb-mcp-server/0.1.0 tool/find_documents',
        });
    });

    it('creates an Entra OIDC MongoClient with an Azure Identity token callback', async () => {
        const getToken = vi.fn(async () => ({ token: 'entra-token', expiresOnTimestamp: Date.now() + 3600_000 }));
        const DefaultAzureCredential = vi.fn(() => ({ getToken }));
        const connect = vi.fn(async () => undefined);
        const close = vi.fn(async () => undefined);
        const MongoClient = vi.fn(function (this: any, uri: string, options?: any) {
            this.uri = uri;
            this.options = options;
            this.connect = connect;
            this.close = close;
        });
        vi.doMock('@azure/identity', () => ({ DefaultAzureCredential }));
        vi.doMock('mongodb', () => ({ MongoClient, AuthMechanism: { MONGODB_OIDC: 'MONGODB-OIDC' } }));

        const { withDocumentDBClient } = await import('../../src/context/documentdb');
        await withDocumentDBClient(
            {
                kind: 'entra',
                uri: 'mongodb+srv://cluster.example.com/?tls=true',
                tokenScope: 'https://example.azure.com/.default',
                appName: 'mcp-test',
            },
            async () => 'ok',
        );

        expect(DefaultAzureCredential).toHaveBeenCalled();
        expect(MongoClient).toHaveBeenCalledWith(
            'mongodb+srv://cluster.example.com/?tls=true',
            expect.objectContaining({
                authMechanism: 'MONGODB-OIDC',
                authSource: '$external',
                appName: 'mcp-test',
            }),
        );
        const options = (MongoClient as any).mock.calls[0][1];
        expect(options.authMechanismProperties.TOKEN_RESOURCE).toBe('https://example.azure.com');
        const oidcResponse = await options.authMechanismProperties.OIDC_CALLBACK();
        expect(getToken).toHaveBeenCalledWith('https://example.azure.com/.default');
        expect(oidcResponse.accessToken).toBe('entra-token');
        expect(oidcResponse.expiresInSeconds).toBeGreaterThan(0);
    });
});
