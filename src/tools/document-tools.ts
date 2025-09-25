/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseParam, parseUpdate, parseParams } from './utils/paramParser';

/**
 * Register document-related tools
 */
export function registerDocumentTools(server: McpServer): void {
    // Find documents tool
    server.registerTool("find_documents",
        {
            title: "Find Documents",
            description: "Find documents in a collection with optional query, limit and skip",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection to query"),
                query: z.union([z.record(z.unknown()), z.string()]).default({}).describe("Query filter in MongoDB style"),
                limit: z.union([z.number(), z.string()]).default(100).describe("Maximum number of documents to return"),
                skip: z.union([z.number(), z.string()]).default(0).describe("Number of documents to skip"),
            }
        },
        async ({ db_name, collection_name, query = {}, limit = 100, skip = 0 }) => {
            try {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                    { raw: limit, expected: 'int', outKey: 'limit', options: { fieldName: 'limit', nonNegative: true } },
                    { raw: skip, expected: 'int', outKey: 'skip', options: { fieldName: 'skip', nonNegative: true } },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const parsedLimit = parsed.limit as number;
                const parsedSkip = parsed.skip as number;

                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);

                const documents = await collection.find(parsedQuery).skip(parsedSkip).limit(parsedLimit).toArray();
                const totalCount = await collection.countDocuments(parsedQuery);

                const response = {
                    documents,
                    total_count: totalCount,
                    limit: parsedLimit,
                    skip: parsedSkip,
                    returned_count: documents.length,
                    has_more: parsedSkip + documents.length < totalCount,
                    query: parsedQuery
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(response, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // Count documents tool
    server.registerTool("count_documents",
        {
            title: "Count Documents",
            description: "Count documents in a collection matching a query",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection to query"),
                query: z.union([z.record(z.unknown()), z.string()]).default({}).describe("Query filter in MongoDB style")
            }
        },
        async ({ db_name, collection_name, query = {} }) => {
            try {
                const { value: parsedQuery } = parseParam<Record<string, unknown>>(query, 'object', { fieldName: 'query' });

                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const count = await collection.countDocuments(parsedQuery);

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count, query: parsedQuery }, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // Insert single document tool
    server.registerTool("insert_document",
        {
            title: "Insert Document",
            description: "Insert a single document into a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                document: z.record(z.unknown()).describe("Document to insert")
            }
        },
        async ({ db_name, collection_name, document }) => {
            try {
                const { value: doc } = parseParam<Record<string, unknown>>(document, 'object', { fieldName: 'document' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.insertOne(doc);
                const response = {
                    inserted_id: result.insertedId,
                    acknowledged: result.acknowledged,
                    inserted_count: 1
                };
                return {
                    content: [ { type: 'text', text: JSON.stringify(response, null, 2) } ]
                };
            } catch (error) {
                return {
                    content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ],
                    isError: true
                };
            }
        }
    );

    // Insert many documents tool
    server.registerTool("insert_many",
        {
            title: "Insert Many Documents",
            description: "Insert multiple documents into a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                documents: z.union([z.array(z.record(z.unknown())), z.string()]).describe("List of documents to insert")
            }
        },
        async ({ db_name, collection_name, documents }) => {
            try {
                const { value: docs } = parseParam<any>(documents, 'array', { fieldName: 'documents' });
                // basic validation each element must be object
                if (!Array.isArray(docs) || docs.some(d => typeof d !== 'object' || d === null || Array.isArray(d))) {
                    throw new Error('documents must be an array of JSON objects');
                }
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.insertMany(docs);
                const insertedIds = Object.values(result.insertedIds).map(id => String(id));
                const response = {
                    inserted_ids: insertedIds,
                    acknowledged: result.acknowledged,
                    inserted_count: insertedIds.length
                };
                return {
                    content: [ { type: 'text', text: JSON.stringify(response, null, 2) } ]
                };
            } catch (error) {
                return {
                    content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ],
                    isError: true
                };
            }
        }
    );

    // Update single document tool
    server.registerTool("update_document",
        {
            title: "Update Single Document",
            description: "Update a document in a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                filter: z.union([z.record(z.unknown()), z.string()]).describe("Query filter to find the document"),
                update: z.union([z.record(z.unknown()), z.string()]).describe("Update operations ($set, $inc, etc.)"),
                upsert: z.union([z.boolean(), z.string()]).default(false).describe("Create document if it doesn't exist")
            }
        },
        async ({ db_name, collection_name, filter, update, upsert = false }) => {
            try {
                const { value: parsedFilter } = parseParam<Record<string, unknown>>(filter, 'object', { fieldName: 'filter' });
                const { value: parsedUpdate } = parseUpdate(update, { fieldName: 'update' });
                const { value: parsedUpsert } = parseParam<boolean>(upsert, 'boolean', { fieldName: 'upsert' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.updateOne(parsedFilter, parsedUpdate, { upsert: parsedUpsert });
                const response = {
                    matched_count: result.matchedCount,
                    modified_count: result.modifiedCount,
                    upserted_id: result.upsertedId ? String(result.upsertedId) : null,
                    acknowledged: result.acknowledged
                };
                return { content: [ { type: 'text', text: JSON.stringify(response, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Update many documents tool
    server.registerTool("update_many",
        {
            title: "Update Many Documents",
            description: "Update multiple documents in a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                filter: z.union([z.record(z.unknown()), z.string()]).describe("Query filter to find the documents"),
                update: z.union([z.record(z.unknown()), z.string()]).describe("Update operations ($set, $inc, etc.)"),
                upsert: z.union([z.boolean(), z.string()]).default(false).describe("Create document if it doesn't exist")
            }
        },
        async ({ db_name, collection_name, filter, update, upsert = false }) => {
            try {
                const { value: parsedFilter } = parseParam<Record<string, unknown>>(filter, 'object', { fieldName: 'filter' });
                const { value: parsedUpdate } = parseUpdate(update, { fieldName: 'update' });
                const { value: parsedUpsert } = parseParam<boolean>(upsert, 'boolean', { fieldName: 'upsert' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.updateMany(parsedFilter, parsedUpdate, { upsert: parsedUpsert });
                const response = {
                    matched_count: result.matchedCount,
                    modified_count: result.modifiedCount,
                    upserted_id: result.upsertedId ? String(result.upsertedId) : null,
                    acknowledged: result.acknowledged
                };
                return { content: [ { type: 'text', text: JSON.stringify(response, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Delete one document tool
    server.registerTool("delete_document",
        {
            title: "Delete Document",
            description: "Delete a document from a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                filter: z.union([z.record(z.unknown()), z.string()]).describe("Query filter to find the document")
            }
        },
        async ({ db_name, collection_name, filter }) => {
            try {
                const { value: parsedFilter } = parseParam<Record<string, unknown>>(filter, 'object', { fieldName: 'filter' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.deleteOne(parsedFilter);
                const response = {
                    deleted_count: result.deletedCount,
                    acknowledged: result.acknowledged
                };
                return { content: [ { type: 'text', text: JSON.stringify(response, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Delete many documents tool
    server.registerTool("delete_many",
        {
            title: "Delete Many Documents",
            description: "Delete multiple documents from a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                filter: z.union([z.record(z.unknown()), z.string()]).describe("Query filter to find the documents")
            }
        },
        async ({ db_name, collection_name, filter }) => {
            try {
                const { value: parsedFilter } = parseParam<Record<string, unknown>>(filter, 'object', { fieldName: 'filter' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.deleteMany(parsedFilter);
                const response = {
                    deleted_count: result.deletedCount,
                    acknowledged: result.acknowledged
                };
                return { content: [ { type: 'text', text: JSON.stringify(response, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Aggregate pipeline tool
    server.registerTool("aggregate",
        {
            title: "Aggregate Pipeline",
            description: "Run an aggregation pipeline on a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                pipeline: z.union([z.array(z.record(z.unknown())), z.string()]).describe("List of aggregation stages"),
                allow_disk_use: z.union([z.boolean(), z.string()]).default(false).describe("Allow pipeline stages to write to disk")
            }
        },
        async ({ db_name, collection_name, pipeline, allow_disk_use = false }) => {
            try {
                const { value: parsedPipeline } = parseParam<any>(pipeline, 'array', { fieldName: 'pipeline' });
                if (!Array.isArray(parsedPipeline)) throw new Error('pipeline must be an array');
                const { value: parsedAllowDisk } = parseParam<boolean>(allow_disk_use, 'boolean', { fieldName: 'allow_disk_use' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const cursor = collection.aggregate(parsedPipeline, { allowDiskUse: parsedAllowDisk });
                const results = await cursor.toArray();
                const response = { results, total_count: results.length };
                return { content: [ { type: 'text', text: JSON.stringify(response, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Explain aggregate query tool
    server.registerTool("explain_aggregate_query",
        {
            title: "Explain Aggregate Query",
            description: "Explain the execution plan with execution stats for an aggregation query on a given collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                pipeline: z.union([z.array(z.record(z.unknown())), z.string()]).describe("List of aggregation stages")
            }
        },
        async ({ db_name, collection_name, pipeline }) => {
            try {
                const { value: parsedPipeline } = parseParam<any>(pipeline, 'array', { fieldName: 'pipeline' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const command = {
                    explain: {
                        aggregate: collection_name,
                        pipeline: parsedPipeline,
                        cursor: {}
                    },
                    verbosity: 'executionStats'
                };
                const explainOutput = await db.command(command as any);
                return { content: [ { type: 'text', text: JSON.stringify(explainOutput, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Explain count query tool
    server.registerTool("explain_count_query",
        {
            title: "Explain Count Query",
            description: "Explain the execution plan with execution stats for count query on a given collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.union([z.record(z.unknown()), z.string()]).default({}).describe("Query filter in MongoDB style")
            }
        },
        async ({ db_name, collection_name, query = {} }) => {
            try {
                const { value: parsedQuery } = parseParam<Record<string, unknown>>(query, 'object', { fieldName: 'query' });
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const command = {
                    explain: {
                        count: collection_name,
                        query: parsedQuery
                    },
                    verbosity: 'executionStats'
                };
                const explainOutput = await db.command(command as any);
                return { content: [ { type: 'text', text: JSON.stringify(explainOutput, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Explain find query tool
    server.registerTool("explain_find_query",
        {
            title: "Explain Find Query",
            description: "Explain the execution plan with execution stats for a find query",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.union([z.record(z.unknown()), z.string()]).default({}).describe("Query filter in MongoDB style"),
                sort: z.union([z.record(z.unknown()), z.string(), z.null()]).optional().describe("Sort specification"),
                limit: z.union([z.number(), z.string(), z.null()]).optional().describe("Limit"),
                projection: z.union([z.record(z.unknown()), z.string(), z.null()]).optional().describe("Projection specification")
            }
        },
        async ({ db_name, collection_name, query = {}, sort, limit, projection }) => {
            try {
                const { value: parsedQuery } = parseParam<Record<string, unknown>>(query, 'object', { fieldName: 'query' });
                const parsedSort = sort === undefined || sort === null ? undefined : parseParam<Record<string, unknown>>(sort, 'object', { fieldName: 'sort' }).value;
                const parsedProjection = projection === undefined || projection === null ? undefined : parseParam<Record<string, unknown>>(projection, 'object', { fieldName: 'projection' }).value;
                let parsedLimit: number | undefined = undefined;
                if (limit !== undefined && limit !== null) {
                    parsedLimit = parseParam<number>(limit, 'int', { fieldName: 'limit', nonNegative: true }).value;
                }
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const findCmd: any = { find: collection_name, filter: parsedQuery };
                if (parsedSort) findCmd.sort = parsedSort;
                if (parsedLimit !== undefined) findCmd.limit = parsedLimit;
                if (parsedProjection) findCmd.projection = parsedProjection;
                const command = { explain: findCmd, verbosity: 'executionStats' };
                const explainOutput = await db.command(command as any);
                return { content: [ { type: 'text', text: JSON.stringify(explainOutput, null, 2) } ] };
            } catch (error) {
                return { content: [ { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) } ], isError: true };
            }
        }
    );

    // Find and modify tool
    server.registerTool("find_and_modify",
        {
            title: "Find And Modify Document",
            description: "Find one document by filter and apply update; returns the document BEFORE modification (or null if it doesn't exist)",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection to query"),
                query: z.union([z.record(z.unknown()), z.string()]).describe("Query filter in MongoDB style"),
                update: z.union([z.record(z.unknown()), z.string()]).describe("Update operations ($set, $inc, etc.)"),
                upsert: z.union([z.boolean(), z.string()]).default(false).describe("Create document if it does not exist")
            }
        },
        async ({ db_name, collection_name, query, update, upsert = false }) => {
            try {
                const { value: parsedQuery } = parseParam<Record<string, unknown>>(query, 'object', { fieldName: 'query' });
                const { value: parsedUpdate } = parseUpdate(update, { fieldName: 'update' });
                const { value: parsedUpsert } = parseParam<boolean>(upsert, 'boolean', { fieldName: 'upsert' });

                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);

                // findOneAndUpdate options: returnDocument: 'before' (default prior to driver v5 is 'before'; we set explicitly)
                const result = await collection.findOneAndUpdate(
                    parsedQuery,
                    parsedUpdate,
                    { upsert: parsedUpsert, returnDocument: 'before' as const }
                );

                const response = {
                    matched: result ? (result.lastErrorObject?.updatedExisting ?? false) : false,
                    upsertedId: result ? result.lastErrorObject?.upserted : undefined,
                    original_document: result ? (result.value ?? null) : null,
                    query: parsedQuery,
                    update: parsedUpdate,
                    upsert
                };

                return {
                    content: [
                        { type: 'text', text: JSON.stringify(response, null, 2) }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        { type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) }
                    ],
                    isError: true
                };
            }
        }
    );
}