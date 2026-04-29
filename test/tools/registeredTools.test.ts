import { afterEach, describe, expect, it, vi } from 'vitest';

interface RegisteredTool {
    config: { inputSchema: Record<string, unknown> };
    handler: (input: Record<string, unknown>) => Promise<any>;
}

const originalEnv = { ...process.env };
const toolNames = [
    'create_index',
    'list_indexes',
    'drop_index',
    'list_databases',
    'drop_database',
    'drop_collection',
    'rename_collection',
    'sample_documents',
    'current_ops',
    'get_statistics',
    'find_documents',
    'count_documents',
    'insert_documents',
    'update_documents',
    'delete_documents',
    'aggregate',
    'find_and_modify',
    'explain_operation',
];

function parseToolResult(result: any): any {
    return JSON.parse(result.content[0].text);
}

function createFakeServer() {
    const tools: Record<string, RegisteredTool> = {};
    const server = {
        registerTool: vi.fn((name: string, config: any, handler: RegisteredTool['handler']) => {
            tools[name] = { config, handler };
        }),
    };
    return { server, tools };
}

function createFakeClient() {
    const findDocuments = [{ _id: 'doc1', status: 'active' }];
    const sampledDocuments = [{ _id: 'sample1' }];
    const aggregateResults = [{ total: 1 }];
    const indexStats = [{ name: 'idx_status', accesses: { ops: 2 } }];
    const indexes = [{ name: '_id_' }, { name: 'idx_status' }];
    const collections = [{ name: 'vehicles' }];

    const collection = {
        aggregate: vi.fn((pipeline: any[], options?: any) => ({
            toArray: vi.fn(async () => {
                if (pipeline.some((stage) => stage.$sample)) return sampledDocuments;
                if (pipeline.some((stage) => stage.$indexStats)) return indexStats;
                return aggregateResults;
            }),
            options,
        })),
        countDocuments: vi.fn(async () => 3),
        createIndex: vi.fn(async () => 'idx_status'),
        deleteMany: vi.fn(async () => ({ acknowledged: true, deletedCount: 2 })),
        deleteOne: vi.fn(async () => ({ acknowledged: true, deletedCount: 1 })),
        dropIndex: vi.fn(async () => ({ ok: 1 })),
        estimatedDocumentCount: vi.fn(async () => 42),
        find: vi.fn((_query: any, _options: any) => ({ toArray: vi.fn(async () => findDocuments) })),
        findOneAndUpdate: vi.fn(async () => ({
            lastErrorObject: { updatedExisting: true },
            value: { _id: 'doc1', status: 'old' },
        })),
        insertMany: vi.fn(async () => ({ acknowledged: true, insertedIds: { 0: 'id1', 1: 'id2' } })),
        insertOne: vi.fn(async () => ({ acknowledged: true, insertedId: 'id1' })),
        listIndexes: vi.fn(() => ({ toArray: vi.fn(async () => indexes) })),
        rename: vi.fn(async () => undefined),
        updateMany: vi.fn(async () => ({ acknowledged: true, matchedCount: 2, modifiedCount: 2, upsertedId: null })),
        updateOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedId: null })),
    };

    const database = {
        collection: vi.fn(() => collection),
        command: vi.fn(async (command: any) => ({ ok: 1, command })),
        dropCollection: vi.fn(async () => true),
        dropDatabase: vi.fn(async () => true),
        listCollections: vi.fn(() => ({ toArray: vi.fn(async () => collections) })),
        stats: vi.fn(async () => ({ db: 'fleet', collections: 1 })),
    };

    const defaultDatabase = {
        ...database,
        admin: vi.fn(() => ({
            listDatabases: vi.fn(async () => ({ databases: [{ name: 'fleet', sizeOnDisk: 100, empty: false }] })),
        })),
    };

    const client = {
        db: vi.fn((name?: string) => (name ? database : defaultDatabase)),
    };

    return { client, collection, database, defaultDatabase };
}

async function setupRegisteredTools() {
    vi.resetModules();
    process.env = {
        ...originalEnv,
        AUTH_REQUIRED: 'false',
        CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake"}}',
        ENABLE_READ_TOOLS: 'true',
        ENABLE_WRITE_TOOLS: 'true',
        ENABLE_MANAGEMENT_TOOLS: 'true',
        ALLOW_AGGREGATE_WRITE_STAGES: 'false',
    };

    const fakeMongo = createFakeClient();
    const withDocumentDBClient = vi.fn(
        async (_connectionString: string, handler: (client: unknown) => Promise<unknown>) => handler(fakeMongo.client),
    );
    vi.doMock('../../src/context/documentdb', () => ({ withDocumentDBClient }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const [{ registerDatabaseTools }, { registerCollectionTools }, { registerIndexTools }, { registerDocumentTools }] =
        await Promise.all([
            import('../../src/tools/database-tools'),
            import('../../src/tools/collection-tools'),
            import('../../src/tools/index-tools'),
            import('../../src/tools/document-tools'),
        ]);

    const { server, tools } = createFakeServer();
    registerDatabaseTools(server as any);
    registerCollectionTools(server as any);
    registerIndexTools(server as any);
    registerDocumentTools(server as any);

    return { tools, withDocumentDBClient, ...fakeMongo };
}

describe('registered DocumentDB tools', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('registers all planned tools with connection_profile input', async () => {
        const { tools } = await setupRegisteredTools();

        expect(Object.keys(tools).sort()).toEqual([...toolNames].sort());
        for (const toolName of toolNames) {
            expect(tools[toolName].config.inputSchema).toHaveProperty('connection_profile');
        }
    });

    it('list_databases lists databases', async () => {
        const { tools } = await setupRegisteredTools();

        const response = parseToolResult(await tools.list_databases.handler({ connection_profile: 'dev' }));

        expect(response.databases).toEqual([{ name: 'fleet', sizeOnDisk: 100, empty: false }]);
    });

    it('drop_database drops a database', async () => {
        const { tools, database } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.drop_database.handler({ connection_profile: 'dev', db_name: 'fleet' }),
        );

        expect(database.dropDatabase).toHaveBeenCalled();
        expect(response.success).toBe(true);
    });

    it('drop_collection drops a collection', async () => {
        const { tools, database } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.drop_collection.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
            }),
        );

        expect(database.dropCollection).toHaveBeenCalledWith('vehicles');
        expect(response.message).toBe('Collection dropped successfully');
    });

    it('rename_collection renames a collection', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.rename_collection.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                new_collection_name: 'cars',
            }),
        );

        expect(collection.rename).toHaveBeenCalledWith('cars', { dropTarget: false });
        expect(response.message).toBe('Collection renamed successfully');
    });

    it('sample_documents samples documents', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.sample_documents.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                sample_size: '5',
            }),
        );

        expect(collection.aggregate).toHaveBeenCalledWith([{ $sample: { size: 5 } }]);
        expect(response).toEqual([{ _id: 'sample1' }]);
    });

    it('current_ops gets current operations', async () => {
        const { tools, database } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.current_ops.handler({ connection_profile: 'dev', ops: { $ownOps: true } }),
        );

        expect(database.command).toHaveBeenCalledWith({ currentOp: true, $ownOps: true });
        expect(response.ok).toBe(1);
    });

    it('get_statistics gets database statistics', async () => {
        const { tools, database } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.get_statistics.handler({ connection_profile: 'dev', scope: 'database', db_name: 'fleet' }),
        );

        expect(database.stats).toHaveBeenCalled();
        expect(response).toEqual({ db: 'fleet', collections: 1 });
    });

    it('create_index creates an index', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.create_index.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                keys: { status: 1 },
                options: { name: 'idx_status' },
            }),
        );

        expect(collection.createIndex).toHaveBeenCalledWith({ status: 1 }, { name: 'idx_status' });
        expect(response.index_name).toBe('idx_status');
    });

    it('list_indexes lists indexes', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.list_indexes.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
            }),
        );

        expect(collection.listIndexes).toHaveBeenCalled();
        expect(response.count).toBe(2);
    });

    it('drop_index drops an index', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.drop_index.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                index_name: 'idx_status',
            }),
        );

        expect(collection.dropIndex).toHaveBeenCalledWith('idx_status');
        expect(response.success).toBe(true);
    });

    it('find_documents finds documents', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.find_documents.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                query: { status: 'active' },
                options: { limit: '2', skip: '1' },
            }),
        );

        expect(collection.find).toHaveBeenCalledWith({ status: 'active' }, { limit: 2, skip: 1 });
        expect(response.returned_count).toBe(1);
        expect(response.total_count).toBe(3);
    });

    it('count_documents counts documents', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.count_documents.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                query: { status: 'active' },
            }),
        );

        expect(collection.countDocuments).toHaveBeenCalledWith({ status: 'active' });
        expect(response.count).toBe(3);
    });

    it('insert_documents inserts one document', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.insert_documents.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                documents: { vin: '1' },
            }),
        );

        expect(collection.insertOne).toHaveBeenCalledWith({ vin: '1' });
        expect(response.inserted_id).toBe('id1');
    });

    it('update_documents updates many documents when multi is true', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.update_documents.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                filter: { status: 'active' },
                update: { $set: { status: 'inactive' } },
                multi: 'true',
            }),
        );

        expect(collection.updateMany).toHaveBeenCalledWith(
            { status: 'active' },
            { $set: { status: 'inactive' } },
            { upsert: false },
        );
        expect(response.modified_count).toBe(2);
    });

    it('delete_documents deletes one document by default', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.delete_documents.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                filter: { vin: '1' },
            }),
        );

        expect(collection.deleteOne).toHaveBeenCalledWith({ vin: '1' });
        expect(response.deleted_count).toBe(1);
    });

    it('aggregate runs a read-only aggregation pipeline', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.aggregate.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                pipeline: [{ $match: { status: 'active' } }],
                allow_disk_use: 'true',
            }),
        );

        expect(collection.aggregate).toHaveBeenCalledWith([{ $match: { status: 'active' } }], { allowDiskUse: true });
        expect(response.total_count).toBe(1);
    });

    it('find_and_modify atomically updates one document', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.find_and_modify.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                query: { vin: '1' },
                update: { $set: { status: 'inactive' } },
            }),
        );

        expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
            { vin: '1' },
            { $set: { status: 'inactive' } },
            expect.objectContaining({ returnDocument: 'before' }),
        );
        expect(response.matched).toBe(true);
    });

    it('explain_operation explains a find operation', async () => {
        const { tools, database } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.explain_operation.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                operation: 'find',
                query: { status: 'active' },
                options: { limit: 10 },
            }),
        );

        expect(database.command).toHaveBeenCalledWith({
            explain: { find: 'vehicles', filter: { status: 'active' }, limit: 10 },
            verbosity: 'executionStats',
        });
        expect(response.explain.ok).toBe(1);
    });
});
