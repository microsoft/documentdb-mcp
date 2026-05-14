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

async function setupRegisteredTools(extraEnv: Record<string, string> = {}) {
    vi.resetModules();
    process.env = {
        ...originalEnv,
        AUTH_REQUIRED: 'false',
        CONNECTION_PROFILES:
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"]}}',
        ENABLE_READ_TOOLS: 'true',
        ENABLE_WRITE_TOOLS: 'true',
        ENABLE_MANAGEMENT_TOOLS: 'true',
        ALLOW_AGGREGATE_WRITE_STAGES: 'false',
        ...extraEnv,
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

    it('exposes destructive-operation confirmation fields in tool input schemas', async () => {
        const { tools } = await setupRegisteredTools();

        expect(tools.drop_database.config.inputSchema).toHaveProperty('confirm_db_name');
        expect(tools.drop_collection.config.inputSchema).toHaveProperty('confirm_collection_name');
        expect(tools.drop_index.config.inputSchema).toHaveProperty('confirm_index_name');
        // rename_collection is intentionally NOT confirmation-gated (reversible operation).
        expect(tools.rename_collection.config.inputSchema).not.toHaveProperty('confirm_collection_name');
    });

    it('list_databases lists databases', async () => {
        const { tools } = await setupRegisteredTools();

        const response = parseToolResult(await tools.list_databases.handler({ connection_profile: 'dev' }));

        expect(response.databases).toEqual([{ name: 'fleet', sizeOnDisk: 100, empty: false }]);
    });

    it('drop_database drops a database', async () => {
        const { tools, database } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.drop_database.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                confirm_db_name: 'fleet',
            }),
        );

        expect(database.dropDatabase).toHaveBeenCalled();
        expect(response.success).toBe(true);
    });

    it('drop_database rejects when confirm_db_name does not match', async () => {
        const { tools, database } = await setupRegisteredTools();

        const result = await tools.drop_database.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            confirm_db_name: 'wrong',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('does not match the target resource');
        expect(database.dropDatabase).not.toHaveBeenCalled();
    });

    it('drop_database rejects when confirm_db_name is missing', async () => {
        const { tools, database } = await setupRegisteredTools();

        const result = await tools.drop_database.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('confirm_db_name is required');
        expect(database.dropDatabase).not.toHaveBeenCalled();
    });

    it('drop_collection drops a collection', async () => {
        const { tools, database } = await setupRegisteredTools();

        const response = parseToolResult(
            await tools.drop_collection.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                confirm_collection_name: 'vehicles',
            }),
        );

        expect(database.dropCollection).toHaveBeenCalledWith('vehicles');
        expect(response.message).toBe('Collection dropped successfully');
    });

    it('drop_collection rejects when confirm_collection_name does not match', async () => {
        const { tools, database } = await setupRegisteredTools();

        const result = await tools.drop_collection.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            confirm_collection_name: 'Vehicles',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('does not match the target resource');
        expect(database.dropCollection).not.toHaveBeenCalled();
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

        expect(collection.aggregate).toHaveBeenCalledWith([{ $sample: { size: 5 } }], { maxTimeMS: 30000 });
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
                confirm_index_name: 'idx_status',
            }),
        );

        expect(collection.dropIndex).toHaveBeenCalledWith('idx_status');
        expect(response.success).toBe(true);
    });

    it('drop_index rejects when confirm_index_name does not match', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const result = await tools.drop_index.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            index_name: 'idx_status',
            confirm_index_name: 'idx_other',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('does not match the target resource');
        expect(collection.dropIndex).not.toHaveBeenCalled();
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

        expect(collection.find).toHaveBeenCalledWith(
            { status: 'active' },
            { limit: 2, skip: 1, maxTimeMS: 30000 },
        );
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

        expect(collection.countDocuments).toHaveBeenCalledWith({ status: 'active' }, { maxTimeMS: 30000 });
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

        expect(collection.aggregate).toHaveBeenCalledWith(
            [{ $match: { status: 'active' } }],
            { allowDiskUse: true, maxTimeMS: 30000 },
        );
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

describe('registered DocumentDB tools — data volume & payload limits', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('find_documents clamps options.limit to MAX_FIND_LIMIT', async () => {
        const { tools, collection } = await setupRegisteredTools({ MAX_FIND_LIMIT: '25' });

        const response = parseToolResult(
            await tools.find_documents.handler({
                connection_profile: 'dev',
                db_name: 'fleet',
                collection_name: 'vehicles',
                query: {},
                options: { limit: 50000 },
            }),
        );

        expect(collection.find).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ limit: 25, skip: 0, maxTimeMS: 30000 }),
        );
        expect(response.applied_options.limit).toBe(25);
    });

    it('find_documents defaults to MAX_FIND_LIMIT when options.limit omitted', async () => {
        const { tools, collection } = await setupRegisteredTools();

        await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });

        expect(collection.find).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ limit: 100, maxTimeMS: 30000 }),
        );
    });

    it('sample_documents clamps sample_size to MAX_SAMPLE_SIZE', async () => {
        const { tools, collection } = await setupRegisteredTools({ MAX_SAMPLE_SIZE: '20' });

        await tools.sample_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            sample_size: 99999,
        });

        expect(collection.aggregate).toHaveBeenCalledWith(
            [{ $sample: { size: 20 } }],
            { maxTimeMS: 30000 },
        );
    });

    it('insert_documents rejects array exceeding MAX_INSERT_BATCH_SIZE without calling insertMany', async () => {
        const { tools, collection } = await setupRegisteredTools({ MAX_INSERT_BATCH_SIZE: '5' });

        const docs = Array.from({ length: 6 }, (_, i) => ({ vin: String(i) }));
        const result = await tools.insert_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            documents: docs,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/exceeds the maximum batch size/i);
        expect(collection.insertMany).not.toHaveBeenCalled();
    });

    it('insert_documents accepts batch at exactly MAX_INSERT_BATCH_SIZE', async () => {
        const { tools, collection } = await setupRegisteredTools({ MAX_INSERT_BATCH_SIZE: '3' });

        const docs = Array.from({ length: 3 }, (_, i) => ({ vin: String(i) }));
        const response = await tools.insert_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            documents: docs,
        });

        expect(response.isError).toBeUndefined();
        expect(collection.insertMany).toHaveBeenCalledTimes(1);
    });

    it('aggregate, count_documents, and find_and_modify all carry maxTimeMS', async () => {
        const { tools, collection } = await setupRegisteredTools();

        await tools.count_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });
        await tools.aggregate.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            pipeline: [{ $match: {} }],
        });
        await tools.find_and_modify.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: { vin: '1' },
            update: { $set: { status: 'x' } },
        });

        expect(collection.countDocuments).toHaveBeenCalledWith({}, { maxTimeMS: 30000 });
        expect(collection.aggregate).toHaveBeenCalledWith(
            [{ $match: {} }],
            expect.objectContaining({ maxTimeMS: 30000 }),
        );
        expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
            { vin: '1' },
            { $set: { status: 'x' } },
            expect.objectContaining({ maxTimeMS: 30000 }),
        );
    });

    it('find_documents rejects when serialized payload exceeds MAX_RETURN_BYTES', async () => {
        const { tools } = await setupRegisteredTools({ MAX_RETURN_BYTES: '256' });

        // Stub the find/count to return a huge document via the existing client mock —
        // we need a fresh setup where the find returns large data. Use a re-mocked toArray.
        const result = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: { huge: 'x'.repeat(2000) },
        });

        // The query alone (echoed in applied_options) exceeds 256 bytes, so the cap fires.
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/exceeds maximum/i);
    });
});

describe('registered DocumentDB tools — per-profile resource allowlists', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    const allowlistedProfile =
        '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}';

    it('rejects a tool call targeting a database outside allowedDatabases', async () => {
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: allowlistedProfile });

        const result = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'secrets',
            collection_name: 'vehicles',
            query: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Database 'secrets' is not allowed/);
        expect(collection.find).not.toHaveBeenCalled();
    });

    it('rejects a tool call targeting a collection outside allowedCollections', async () => {
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: allowlistedProfile });

        const result = await tools.count_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'maintenance',
            query: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Collection 'fleet\.maintenance' is not allowed/);
        expect(collection.countDocuments).not.toHaveBeenCalled();
    });

    it('allows a tool call when both database and collection are allowed', async () => {
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: allowlistedProfile });

        const response = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });

        expect(response.isError).toBeUndefined();
        expect(collection.find).toHaveBeenCalledTimes(1);
    });

    it('rejects rename_collection when the new collection name is not allowed', async () => {
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: allowlistedProfile });

        const result = await tools.rename_collection.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            new_collection_name: 'secrets',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Collection 'fleet\.secrets' is not allowed/);
        expect(collection.rename).not.toHaveBeenCalled();
    });

    it('list_databases filters out non-allowed databases when no db_name is given', async () => {
        const allowlist =
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"]}}';
        const { tools } = await setupRegisteredTools({ CONNECTION_PROFILES: allowlist });

        const response = parseToolResult(await tools.list_databases.handler({ connection_profile: 'dev' }));

        // The fake admin().listDatabases() returns only 'fleet', and 'fleet' IS allowed, so it remains.
        expect(response.databases).toEqual([{ name: 'fleet', sizeOnDisk: 100, empty: false }]);
    });

    it('list_databases hides a database that is not in allowedDatabases', async () => {
        // Allow only a non-existent db so the fake's 'fleet' entry is filtered out.
        const allowlist =
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["other"]}}';
        const { tools } = await setupRegisteredTools({ CONNECTION_PROFILES: allowlist });

        const response = parseToolResult(await tools.list_databases.handler({ connection_profile: 'dev' }));

        expect(response.databases).toEqual([]);
    });

    it('list_databases (per-db branch) filters collections outside allowedCollections', async () => {
        // Allow the 'fleet' db but only the 'maintenance' collection — fake returns only 'vehicles' so result is empty.
        const allowlist =
            '{"dev":{"uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":["maintenance"]}}}';
        const { tools } = await setupRegisteredTools({ CONNECTION_PROFILES: allowlist });

        const response = parseToolResult(
            await tools.list_databases.handler({ connection_profile: 'dev', db_name: 'fleet' }),
        );

        expect(response.collections).toEqual([]);
    });

    it('passes through unchanged when no allowlist is configured', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const response = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'whatever',
            collection_name: 'anything',
            query: {},
        });

        expect(response.isError).toBeUndefined();
        expect(collection.find).toHaveBeenCalledTimes(1);
    });

    it('treats allowedDatabases:[] as explicit deny-all at the wiring layer', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":[]}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /Database 'fleet' is not allowed.*Allowed databases: \(none\)\./,
        );
        expect(collection.find).not.toHaveBeenCalled();
    });

    it('treats allowedCollections[db]:[] as explicit deny-all at the wiring layer', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":[]}}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.count_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /Collection 'fleet\.vehicles' is not allowed.*Allowed collections in 'fleet': \(none\)\./,
        );
        expect(collection.countDocuments).not.toHaveBeenCalled();
    });

    it('list_databases returns empty when allowedDatabases:[] (deny-all)', async () => {
        const profiles = '{"dev":{"uri":"mongodb://fake","allowedDatabases":[]}}';
        const { tools } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const response = parseToolResult(await tools.list_databases.handler({ connection_profile: 'dev' }));

        expect(response.databases).toEqual([]);
    });
});

describe('registered DocumentDB tools — per-profile capability tier restrictions', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('rejects a write tool when allowedRoles excludes write', async () => {
        const profiles = '{"dev":{"uri":"mongodb://fake","allowedRoles":["read"]}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.insert_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            documents: [{ x: 1 }],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Tool tier 'write' is not allowed for connection profile 'dev'/);
        expect(collection.insertOne).not.toHaveBeenCalled();
        expect(collection.insertMany).not.toHaveBeenCalled();
    });

    it('rejects a management tool when allowedRoles excludes management', async () => {
        const profiles = '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write"]}}';
        const { tools } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.drop_collection.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            confirm_collection_name: 'vehicles',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Tool tier 'management' is not allowed/);
    });

    it('allows a read tool when allowedRoles=["read"]', async () => {
        const profiles = '{"dev":{"uri":"mongodb://fake","allowedRoles":["read"]}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const response = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });

        expect(response.isError).toBeUndefined();
        expect(collection.find).toHaveBeenCalledTimes(1);
    });

    it('defaults to read-only when no allowedRoles is configured', async () => {
        // Override the test scaffolding's permissive default with a profile that omits allowedRoles entirely.
        const profiles = '{"dev":{"uri":"mongodb://fake"}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        // Read tool succeeds.
        const readResponse = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });
        expect(readResponse.isError).toBeUndefined();
        expect(collection.find).toHaveBeenCalledTimes(1);

        // Write tool denied by the read-only default.
        const writeResult = await tools.insert_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            documents: [{ x: 1 }],
        });
        expect(writeResult.isError).toBe(true);
        expect(writeResult.content[0].text).toMatch(/Tool tier 'write' is not allowed.*Allowed tiers: read\./);
        expect(collection.insertMany).not.toHaveBeenCalled();
    });

    it('treats allowedRoles:[] as explicit deny-all (denies even read tools)', async () => {
        const profiles = '{"dev":{"uri":"mongodb://fake","allowedRoles":[]}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            query: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /Tool tier 'read' is not allowed.*Allowed tiers: \(none\)\./,
        );
        expect(collection.find).not.toHaveBeenCalled();
    });
});

describe('registered DocumentDB tools — per-profile resource denylists (deny wins)', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('rejects a tool call targeting a denied database', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"deniedDatabases":["secrets"]}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.find_documents.handler({
            connection_profile: 'dev',
            db_name: 'secrets',
            collection_name: 'passwords',
            query: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Database 'secrets' is denied for connection profile 'dev'\./);
        expect(collection.find).not.toHaveBeenCalled();
    });

    it('rejects a tool call targeting a denied collection', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"deniedCollections":{"fleet":["audit_log"]}}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.count_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'audit_log',
            query: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Collection 'fleet\.audit_log' is denied for connection profile 'dev'\./);
        expect(collection.countDocuments).not.toHaveBeenCalled();
    });

    it('list_databases hides a denied database from the response', async () => {
        const profiles = '{"dev":{"uri":"mongodb://fake","deniedDatabases":["secrets"]}}';
        const { tools, database } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });
        (database as any).admin = () => ({
            listDatabases: vi.fn(async () => ({
                databases: [
                    { name: 'fleet', sizeOnDisk: 1, empty: false },
                    { name: 'secrets', sizeOnDisk: 2, empty: false },
                ],
            })),
        });

        const response = parseToolResult(await tools.list_databases.handler({ connection_profile: 'dev' }));

        expect(response.databases.map((d: any) => d.name)).toEqual(['fleet']);
    });
});

describe('registered DocumentDB tools — pipeline namespace enforcement', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('aggregate rejects a pipeline whose $lookup.from is outside the collection allowlist', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.aggregate.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            pipeline: [{ $lookup: { from: 'audit_log', as: 'a' } }],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /Aggregation stage \$lookup references fleet\.audit_log:.*Collection 'fleet\.audit_log' is not allowed/,
        );
        expect(collection.aggregate).not.toHaveBeenCalled();
    });

    it('aggregate rejects a $unionWith targeting a denied collection', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"deniedCollections":{"fleet":["audit_log"]}}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.aggregate.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            pipeline: [{ $unionWith: 'audit_log' }],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /Aggregation stage \$unionWith references fleet\.audit_log:.*denied/,
        );
        expect(collection.aggregate).not.toHaveBeenCalled();
    });

    it('aggregate rejects a cross-database $lookup when target db is not allowed', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"]}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.aggregate.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            pipeline: [{ $lookup: { from: { db: 'secrets', coll: 'passwords' }, as: 'p' } }],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /Aggregation stage \$lookup references secrets\.passwords:.*Database 'secrets' is not allowed/,
        );
        expect(collection.aggregate).not.toHaveBeenCalled();
    });

    it('aggregate allows a pipeline whose namespaces are all in scope', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles","maintenance"]}}}';
        const { tools, collection } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.aggregate.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            pipeline: [{ $lookup: { from: 'maintenance', as: 'm' } }, { $match: { status: 'active' } }],
        });

        expect(result.isError).toBeUndefined();
        expect(collection.aggregate).toHaveBeenCalled();
    });

    it('explain_operation also walks pipeline namespaces for operation=aggregate', async () => {
        const profiles =
            '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}';
        const { tools, database } = await setupRegisteredTools({ CONNECTION_PROFILES: profiles });

        const result = await tools.explain_operation.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            operation: 'aggregate',
            pipeline: [{ $lookup: { from: 'leaks', as: 'l' } }],
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Aggregation stage \$lookup references fleet\.leaks/);
        expect(database.command).not.toHaveBeenCalled();
    });
});

describe('registered DocumentDB tools — full-collection operation protection', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('delete_documents with multi=true and empty filter is rejected without confirm flag', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const result = await tools.delete_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            filter: {},
            multi: true,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /delete_documents with multi=true and an empty filter.*confirm_full_collection_operation=true/,
        );
        expect(collection.deleteMany).not.toHaveBeenCalled();
    });

    it('delete_documents with multi=true and empty filter proceeds when confirm_full_collection_operation=true', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const result = await tools.delete_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            filter: {},
            multi: true,
            confirm_full_collection_operation: true,
        });

        expect(result.isError).toBeUndefined();
        expect(collection.deleteMany).toHaveBeenCalledWith({});
    });

    it('update_documents with multi=true and empty filter is rejected without confirm flag', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const result = await tools.update_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            filter: {},
            update: { $set: { archived: true } },
            multi: true,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(
            /update_documents with multi=true and an empty filter.*confirm_full_collection_operation=true/,
        );
        expect(collection.updateMany).not.toHaveBeenCalled();
    });

    it('update_documents with non-empty filter proceeds without confirm flag (multi=true)', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const result = await tools.update_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            filter: { status: 'inactive' },
            update: { $set: { archived: true } },
            multi: true,
        });

        expect(result.isError).toBeUndefined();
        expect(collection.updateMany).toHaveBeenCalled();
    });

    it('delete_documents with multi=false and empty filter proceeds without confirm flag', async () => {
        const { tools, collection } = await setupRegisteredTools();

        const result = await tools.delete_documents.handler({
            connection_profile: 'dev',
            db_name: 'fleet',
            collection_name: 'vehicles',
            filter: {},
            multi: false,
        });

        expect(result.isError).toBeUndefined();
        expect(collection.deleteOne).toHaveBeenCalledWith({});
    });
});
