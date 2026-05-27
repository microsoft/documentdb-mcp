import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const originalEnv = { ...process.env };

function setEnv(overrides: NodeJS.ProcessEnv = {}) {
    vi.resetModules();
    process.env = {
        ...originalEnv,
        AUTH_REQUIRED: 'false',
        ENABLE_READ_TOOLS: 'true',
        ENABLE_WRITE_TOOLS: 'true',
        ENABLE_MANAGEMENT_TOOLS: 'true',
        CONNECTION_PROFILES:
            '{"dev":{"authMode":"connectionString","uri":"mongodb://fake","allowedRoles":["read","write","management"]}}',
        ...overrides,
    };
}

interface CapturedTool {
    config: { title: string; description: string; inputSchema: Record<string, unknown> };
    handler: (input: Record<string, unknown>) => Promise<any>;
}

function createFakeServer() {
    const tools: Record<string, CapturedTool> = {};
    const server = {
        registerTool: vi.fn((name: string, config: any, handler: CapturedTool['handler']) => {
            tools[name] = { config, handler };
        }),
    };
    return { server, tools };
}

describe('tool registry', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    describe('defineTool', () => {
        it('returns the same definition object it was given (identity helper)', async () => {
            setEnv();
            const { defineTool } = await import('../../src/tools/registry');

            const def = {
                name: 'noop',
                title: 'Noop',
                description: 'does nothing',
                requiredRole: 'read' as const,
                inputSchema: { connection_profile: z.string() },
                handler: async () => ({}),
            };

            expect(defineTool(def)).toBe(def);
        });
    });

    describe('registerToolDefinitions', () => {
        it('forwards title/description/inputSchema verbatim and registers each definition once', async () => {
            setEnv();
            const { defineTool, registerToolDefinitions } = await import('../../src/tools/registry');
            const { server } = createFakeServer();

            const defs = [
                defineTool({
                    name: 'a',
                    title: 'A',
                    description: 'desc-a',
                    requiredRole: 'read' as const,
                    inputSchema: { connection_profile: z.string() },
                    handler: async () => ({}),
                }),
                defineTool({
                    name: 'b',
                    title: 'B',
                    description: 'desc-b',
                    requiredRole: 'read' as const,
                    inputSchema: { connection_profile: z.string(), x: z.number() },
                    handler: async () => ({}),
                }),
            ];

            registerToolDefinitions(server as any, defs);

            expect(server.registerTool).toHaveBeenCalledTimes(2);

            const [firstName, firstConfig] = server.registerTool.mock.calls[0];
            expect(firstName).toBe('a');
            expect(firstConfig).toMatchObject({ title: 'A', description: 'desc-a' });
            expect(firstConfig.inputSchema).toBe(defs[0].inputSchema);

            const [secondName, secondConfig] = server.registerTool.mock.calls[1];
            expect(secondName).toBe('b');
            expect(secondConfig).toMatchObject({ title: 'B', description: 'desc-b' });
            expect(secondConfig.inputSchema).toBe(defs[1].inputSchema);
        });

        it('wraps every handler with withDbGuard so missing connection_profile is rejected without invoking the handler', async () => {
            setEnv();
            const { defineTool, registerToolDefinitions } = await import('../../src/tools/registry');
            const { server, tools } = createFakeServer();

            const userHandler = vi.fn(async () => ({}));
            registerToolDefinitions(server as any, [
                defineTool({
                    name: 'guarded',
                    title: 'Guarded',
                    description: 'wraps with withDbGuard',
                    requiredRole: 'read' as const,
                    inputSchema: { connection_profile: z.string() },
                    handler: userHandler,
                }),
            ]);

            const result = await tools.guarded.handler({ connection_profile: '' });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('connection_profile is required');
            expect(userHandler).not.toHaveBeenCalled();
        });

        it('runs the user handler with a Mongo client when the guard allows the call', async () => {
            setEnv();
            const fakeClient = { db: vi.fn(() => ({})) };
            const withDocumentDBClient = vi.fn(
                async (_uri: string, fn: (client: unknown) => Promise<unknown>) => fn(fakeClient),
            );
            vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient }));
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            const { defineTool, registerToolDefinitions } = await import('../../src/tools/registry');
            const { server, tools } = createFakeServer();

            const userHandler = vi.fn(async (_input: any, client: any) => ({
                content: [{ type: 'text', text: JSON.stringify({ ok: true, sameClient: client === fakeClient }) }],
            }));

            registerToolDefinitions(server as any, [
                defineTool({
                    name: 'allowed',
                    title: 'Allowed',
                    description: 'should run',
                    requiredRole: 'read' as const,
                    inputSchema: { connection_profile: z.string() },
                    handler: userHandler,
                }),
            ]);

            const result = await tools.allowed.handler({ connection_profile: 'dev' });

            expect(userHandler).toHaveBeenCalledTimes(1);
            const [inputArg, clientArg] = userHandler.mock.calls[0];
            expect(inputArg).toMatchObject({ connection_profile: 'dev' });
            expect(clientArg).toBe(fakeClient);
            expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, sameClient: true });
        });

        it('enforces the requiredRole declared on the definition (write role denied when ENABLE_WRITE_TOOLS=false)', async () => {
            setEnv({ ENABLE_WRITE_TOOLS: 'false' });
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const withDocumentDBClient = vi.fn();
            vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient }));

            const { defineTool, registerToolDefinitions } = await import('../../src/tools/registry');
            const { server, tools } = createFakeServer();
            const userHandler = vi.fn();

            registerToolDefinitions(server as any, [
                defineTool({
                    name: 'writes',
                    title: 'Writes',
                    description: 'requires write capability',
                    requiredRole: 'write' as const,
                    inputSchema: { connection_profile: z.string() },
                    handler: userHandler,
                }),
            ]);

            const result = await tools.writes.handler({ connection_profile: 'dev' });

            expect(result.isError).toBe(true);
            expect(userHandler).not.toHaveBeenCalled();
            expect(withDocumentDBClient).not.toHaveBeenCalled();
        });
    });

    describe('allToolDefinitions aggregator', () => {
        it('exposes exactly the 18 expected tools with no duplicates', async () => {
            setEnv();
            const { allToolDefinitions } = await import('../../src/tools');

            const names = allToolDefinitions.map((def) => def.name);
            const unique = new Set(names);

            expect(unique.size).toBe(names.length);
            expect([...unique].sort()).toEqual(
                [
                    'aggregate',
                    'count_documents',
                    'create_index',
                    'current_ops',
                    'delete_documents',
                    'drop_collection',
                    'drop_database',
                    'drop_index',
                    'explain_operation',
                    'find_and_modify',
                    'find_documents',
                    'get_statistics',
                    'insert_documents',
                    'list_databases',
                    'list_indexes',
                    'rename_collection',
                    'sample_documents',
                    'update_documents',
                ].sort(),
            );
        });

        it('every aggregated definition declares the required ToolDefinition fields', async () => {
            setEnv();
            const { allToolDefinitions } = await import('../../src/tools');

            for (const def of allToolDefinitions) {
                expect(typeof def.name).toBe('string');
                expect(typeof def.title).toBe('string');
                expect(typeof def.description).toBe('string');
                expect(['read', 'write', 'management']).toContain(def.requiredRole);
                expect(def.inputSchema).toHaveProperty('connection_profile');
                expect(typeof def.handler).toBe('function');
            }
        });

        it('registerAllTools registers every aggregated definition on the server', async () => {
            setEnv();
            const { registerAllTools, allToolDefinitions } = await import('../../src/tools');
            const { server, tools } = createFakeServer();

            registerAllTools(server as any);

            expect(server.registerTool).toHaveBeenCalledTimes(allToolDefinitions.length);
            expect(Object.keys(tools).sort()).toEqual(allToolDefinitions.map((d) => d.name).sort());
        });
    });
});
