/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../config';
import { withDbGuard } from './utils/dbGuard';
import { parseParams, parseUpdate } from './utils/paramParser';
import { connectionProfileSchema } from './utils/toolSecurity';
const objectOrStringSchema = z.union([z.record(z.unknown()), z.string()]);
const aggregateWriteStages = new Set(['$out', '$merge']);

function assertAggregatePipelineIsReadOnly(pipeline: unknown[]): void {
    if (config.capabilities.allowWriteStagesInAggregate) return;
    for (const stage of pipeline) {
        if (!stage || typeof stage !== 'object' || Array.isArray(stage)) continue;
        const stageOperators = Object.keys(stage as Record<string, unknown>);
        const writeStage = stageOperators.find((operator) => aggregateWriteStages.has(operator));
        if (writeStage) {
            throw new Error(
                `Aggregation stage ${writeStage} is disabled by default. Set ALLOW_AGGREGATE_WRITE_STAGES=true to opt in.`,
            );
        }
    }
}

function normalizeFindOptions(options: Record<string, any> | undefined) {
    const findOptions: Record<string, any> = {};
    if (!options) return findOptions;

    if (options.sort !== undefined) findOptions.sort = options.sort;
    if (options.projection !== undefined) findOptions.projection = options.projection;
    if (options.limit !== undefined) {
        const limit = typeof options.limit === 'string' ? Number(options.limit) : options.limit;
        if (Number.isFinite(limit) && limit >= 0) findOptions.limit = limit;
    }
    if (options.skip !== undefined) {
        const skip = typeof options.skip === 'string' ? Number(options.skip) : options.skip;
        if (Number.isFinite(skip) && skip >= 0) findOptions.skip = skip;
    }

    return findOptions;
}

export function registerDocumentTools(server: McpServer): void {
    server.registerTool(
        'find_documents',
        {
            title: 'Find Documents',
            description:
                'Find documents in a collection. Supports consolidated options object: limit, skip, sort, projection.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                query: objectOrStringSchema.default({}).describe('Query filter in MongoDB style'),
                options: z
                    .union([z.record(z.unknown()), z.string()])
                    .optional()
                    .describe('Consolidated options: limit (default 100), skip (default 0), sort, projection'),
            },
        },
        withDbGuard(
            { toolName: 'find_documents', requiredRole: 'read' },
            async ({ db_name, collection_name, query = {}, options }, client) => {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                    {
                        raw: options,
                        expected: 'object',
                        outKey: 'options',
                        options: { fieldName: 'options', optional: true, treatEmptyObjectAsUndefined: true },
                    },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const rawOptions = (parsed.options || {}) as Record<string, any>;
                const findOptions = normalizeFindOptions({ limit: 100, skip: 0, ...rawOptions });
                const collection = client.db(db_name).collection(collection_name);
                const documents = await collection.find(parsedQuery, findOptions).toArray();
                const totalCount = await collection.countDocuments(parsedQuery);
                const limit = typeof findOptions.limit === 'number' ? findOptions.limit : 100;
                const skip = typeof findOptions.skip === 'number' ? findOptions.skip : 0;
                const response = {
                    documents,
                    total_count: totalCount,
                    returned_count: documents.length,
                    has_more: skip + documents.length < totalCount,
                    query: parsedQuery,
                    applied_options: { ...findOptions, limit, skip },
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            },
        ),
    );

    server.registerTool(
        'count_documents',
        {
            title: 'Count Documents',
            description: 'Count documents in a collection matching a query',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                query: objectOrStringSchema.default({}).describe('Query filter in MongoDB style'),
            },
        },
        withDbGuard(
            { toolName: 'count_documents', requiredRole: 'read' },
            async ({ db_name, collection_name, query = {} }, client) => {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const count = await client.db(db_name).collection(collection_name).countDocuments(parsedQuery);
                return { content: [{ type: 'text', text: JSON.stringify({ count, query: parsedQuery }, null, 2) }] };
            },
        ),
    );

    server.registerTool(
        'insert_documents',
        {
            title: 'Insert Documents',
            description:
                'Insert one or more documents. Pass a single document object for insertOne, or an array of documents for insertMany.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                documents: z
                    .union([z.record(z.unknown()), z.array(z.record(z.unknown())), z.string()])
                    .describe('Document object, array of documents, or JSON string of either'),
            },
        },
        withDbGuard(
            { toolName: 'insert_documents', requiredRole: 'write' },
            async ({ db_name, collection_name, documents }, client) => {
                const parsed = parseParams([
                    { raw: documents, expected: 'any', outKey: 'documents', options: { fieldName: 'documents' } },
                ]);
                const parsedDocuments =
                    typeof parsed.documents === 'string' ? JSON.parse(parsed.documents) : parsed.documents;
                const collection = client.db(db_name).collection(collection_name);

                if (Array.isArray(parsedDocuments)) {
                    if (parsedDocuments.length === 0) throw new Error('documents array must not be empty');
                    if (parsedDocuments.some((doc) => typeof doc !== 'object' || doc === null || Array.isArray(doc))) {
                        throw new Error('documents array must contain JSON objects only');
                    }
                    const result = await collection.insertMany(parsedDocuments as Record<string, unknown>[]);
                    const insertedIds = Object.values(result.insertedIds).map((id) => String(id));
                    const response = {
                        inserted_ids: insertedIds,
                        acknowledged: result.acknowledged,
                        inserted_count: insertedIds.length,
                    };
                    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
                }

                if (typeof parsedDocuments !== 'object' || parsedDocuments === null) {
                    throw new Error('documents must be a JSON object or an array of JSON objects');
                }
                const result = await collection.insertOne(parsedDocuments as Record<string, unknown>);
                const response = {
                    inserted_id: String(result.insertedId),
                    acknowledged: result.acknowledged,
                    inserted_count: 1,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            },
        ),
    );

    server.registerTool(
        'update_documents',
        {
            title: 'Update Documents',
            description:
                'Update one or more documents in a collection. Set multi=true for updateMany; default false uses updateOne.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                filter: objectOrStringSchema.describe('Query filter'),
                update: objectOrStringSchema.describe('Update operations ($set, $inc, etc.) or replacement document'),
                upsert: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe("Create the document if it doesn't exist"),
                multi: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe('When true, update all matching documents'),
            },
        },
        withDbGuard(
            { toolName: 'update_documents', requiredRole: 'write' },
            async ({ db_name, collection_name, filter, update, upsert = false, multi = false }, client) => {
                const parsed = parseParams([
                    { raw: filter, expected: 'object', outKey: 'filter', options: { fieldName: 'filter' } },
                    { raw: update, outKey: 'update', custom: (raw) => parseUpdate(raw, { fieldName: 'update' }).value },
                    { raw: upsert, expected: 'boolean', outKey: 'upsert', options: { fieldName: 'upsert' } },
                    { raw: multi, expected: 'boolean', outKey: 'multi', options: { fieldName: 'multi' } },
                ]);
                const collection = client.db(db_name).collection(collection_name);
                const result = parsed.multi
                    ? await collection.updateMany(parsed.filter as any, parsed.update as any, {
                          upsert: parsed.upsert as boolean,
                      })
                    : await collection.updateOne(parsed.filter as any, parsed.update as any, {
                          upsert: parsed.upsert as boolean,
                      });
                const response = {
                    matched_count: result.matchedCount,
                    modified_count: result.modifiedCount,
                    upserted_id: result.upsertedId ? String(result.upsertedId) : null,
                    acknowledged: result.acknowledged,
                    multi: parsed.multi,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            },
        ),
    );

    server.registerTool(
        'delete_documents',
        {
            title: 'Delete Documents',
            description:
                'Delete one or more documents from a collection. Set multi=true for deleteMany; default false uses deleteOne.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                filter: objectOrStringSchema.describe('Query filter'),
                multi: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe('When true, delete all matching documents'),
            },
        },
        withDbGuard(
            { toolName: 'delete_documents', requiredRole: 'write' },
            async ({ db_name, collection_name, filter, multi = false }, client) => {
                const parsed = parseParams([
                    { raw: filter, expected: 'object', outKey: 'filter', options: { fieldName: 'filter' } },
                    { raw: multi, expected: 'boolean', outKey: 'multi', options: { fieldName: 'multi' } },
                ]);
                const collection = client.db(db_name).collection(collection_name);
                const result = parsed.multi
                    ? await collection.deleteMany(parsed.filter as any)
                    : await collection.deleteOne(parsed.filter as any);
                const response = {
                    deleted_count: result.deletedCount,
                    acknowledged: result.acknowledged,
                    multi: parsed.multi,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            },
        ),
    );

    server.registerTool(
        'aggregate',
        {
            title: 'Aggregate',
            description: 'Run an aggregation pipeline on a collection',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                pipeline: z.union([z.array(z.record(z.unknown())), z.string()]).describe('Aggregation pipeline stages'),
                allow_disk_use: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe('Allow pipeline stages to write to disk'),
            },
        },
        withDbGuard(
            { toolName: 'aggregate', requiredRole: 'read' },
            async ({ db_name, collection_name, pipeline, allow_disk_use = false }, client) => {
                const parsed = parseParams([
                    { raw: pipeline, expected: 'array', outKey: 'pipeline', options: { fieldName: 'pipeline' } },
                    {
                        raw: allow_disk_use,
                        expected: 'boolean',
                        outKey: 'allow_disk_use',
                        options: { fieldName: 'allow_disk_use' },
                    },
                ]);
                assertAggregatePipelineIsReadOnly(parsed.pipeline as unknown[]);
                const results = await client
                    .db(db_name)
                    .collection(collection_name)
                    .aggregate(parsed.pipeline as any[], { allowDiskUse: parsed.allow_disk_use as boolean })
                    .toArray();
                return {
                    content: [
                        { type: 'text', text: JSON.stringify({ results, total_count: results.length }, null, 2) },
                    ],
                };
            },
        ),
    );

    server.registerTool(
        'find_and_modify',
        {
            title: 'Find And Modify',
            description:
                'Find one document and apply an update atomically. Returns the document BEFORE modification, or null if it did not exist.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                query: objectOrStringSchema.describe('Query filter'),
                update: objectOrStringSchema.describe('Update operations ($set, $inc, etc.)'),
                upsert: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe('Create document if it does not exist'),
            },
        },
        withDbGuard(
            { toolName: 'find_and_modify', requiredRole: 'write' },
            async ({ db_name, collection_name, query, update, upsert = false }, client) => {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                    { raw: update, outKey: 'update', custom: (raw) => parseUpdate(raw, { fieldName: 'update' }).value },
                    { raw: upsert, expected: 'boolean', outKey: 'upsert', options: { fieldName: 'upsert' } },
                ]);
                const result = await client
                    .db(db_name)
                    .collection(collection_name)
                    .findOneAndUpdate(
                        parsed.query as any,
                        parsed.update as any,
                        {
                            upsert: parsed.upsert as boolean,
                            returnDocument: 'before',
                            includeResultMetadata: true,
                        } as any,
                    );
                const metadata = result as any;
                const response = {
                    matched: metadata.lastErrorObject?.updatedExisting ?? false,
                    upserted_id: metadata.lastErrorObject?.upserted
                        ? String(metadata.lastErrorObject.upserted)
                        : undefined,
                    original_document: metadata.value ?? null,
                    query: parsed.query,
                    update: parsed.update,
                    upsert: parsed.upsert,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            },
        ),
    );

    server.registerTool(
        'explain_operation',
        {
            title: 'Explain Operation',
            description:
                'Explain the execution plan with executionStats verbosity for a find, count, or aggregate operation.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                operation: z.enum(['find', 'count', 'aggregate']).describe('Which operation to explain'),
                query: objectOrStringSchema.default({}).describe('Filter for find/count operations'),
                options: z
                    .union([z.record(z.unknown()), z.string()])
                    .optional()
                    .describe('For operation=find: consolidated options object with sort, projection, limit, skip'),
                pipeline: z
                    .union([z.array(z.record(z.unknown())), z.string()])
                    .optional()
                    .describe('Aggregation pipeline stages; required when operation=aggregate'),
            },
        },
        withDbGuard(
            { toolName: 'explain_operation', requiredRole: 'read' },
            async ({ db_name, collection_name, operation, query = {}, options, pipeline }, client) => {
                const db = client.db(db_name);
                if (operation === 'aggregate') {
                    const parsed = parseParams([
                        { raw: pipeline, expected: 'array', outKey: 'pipeline', options: { fieldName: 'pipeline' } },
                    ]);
                    assertAggregatePipelineIsReadOnly(parsed.pipeline as unknown[]);
                    const command = {
                        explain: { aggregate: collection_name, pipeline: parsed.pipeline as any[], cursor: {} },
                        verbosity: 'executionStats',
                    };
                    const explain = await db.command(command as any);
                    return { content: [{ type: 'text', text: JSON.stringify(explain, null, 2) }] };
                }

                const parsed = parseParams([
                    {
                        raw: query,
                        expected: 'object',
                        outKey: 'query',
                        options: { fieldName: 'query', defaultValue: {} },
                    },
                    {
                        raw: options,
                        expected: 'object',
                        outKey: 'options',
                        options: { fieldName: 'options', optional: true, treatEmptyObjectAsUndefined: true },
                    },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                if (operation === 'count') {
                    const command = {
                        explain: { count: collection_name, query: parsedQuery },
                        verbosity: 'executionStats',
                    };
                    const explain = await db.command(command as any);
                    return { content: [{ type: 'text', text: JSON.stringify(explain, null, 2) }] };
                }

                const findOptions = normalizeFindOptions(parsed.options as Record<string, any> | undefined);
                const findCommand: Record<string, any> = { find: collection_name, filter: parsedQuery };
                if (findOptions.sort !== undefined) findCommand.sort = findOptions.sort;
                if (findOptions.projection !== undefined) findCommand.projection = findOptions.projection;
                if (findOptions.limit !== undefined) findCommand.limit = findOptions.limit;
                if (findOptions.skip !== undefined) findCommand.skip = findOptions.skip;
                const command = { explain: findCommand, verbosity: 'executionStats' };
                const explain = await db.command(command as any);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ options_applied: findOptions, explain }, null, 2),
                        },
                    ],
                };
            },
        ),
    );
}
