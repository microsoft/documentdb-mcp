/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseParam, parseParams } from './utils/paramParser';
import { analyzeFindExplain } from './utils/explainAnalyzer';

/**
 * Register workflow-related tools
 */
export function registerWorkflowTools(server: McpServer): void {
    // Optimize find query tool
    server.registerTool("optimize_find_query",
        {
            title: "Optimize Find Query",
            description: "Provide all the information needed for optimizing find query, including execution plan with metrics, index information and collection statistics. Support sort, projection, limit, and skip.",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.union([z.record(z.unknown()), z.string()]).default({}).describe("Query filter in MongoDB style"),
                sort: z.union([z.record(z.number()), z.string()]).optional().describe("Sort specification in MongoDB style"),
                projection: z.union([z.record(z.number()), z.string()]).optional().describe("Projection specification in MongoDB style"),
                limit: z.union([z.number(), z.string()]).optional().describe("Limit the number of documents returned (number or numeric string)"),
                skip: z.union([z.number(), z.string()]).optional().describe("Number of documents to skip (number or numeric string)")
            }
        },
        async ({ db_name, collection_name, query, sort, projection, limit, skip }) => {
            try {
                // Batch parse parameters with new optional semantics
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query', defaultValue: {} } },
                    { raw: sort, expected: 'object', outKey: 'sort', options: { fieldName: 'sort', optional: true, treatEmptyObjectAsUndefined: true } },
                    { raw: projection, expected: 'object', outKey: 'projection', options: { fieldName: 'projection', optional: true, treatEmptyObjectAsUndefined: true } },
                    { raw: limit, expected: 'int', outKey: 'limit', options: { fieldName: 'limit', optional: true, nonNegative: true } },
                    { raw: skip, expected: 'int', outKey: 'skip', options: { fieldName: 'skip', optional: true, nonNegative: true } },
                ]);

                const parsedQuery = parsed.query || {};
                const findOptions: any = {};
                if (parsed.sort !== undefined) findOptions.sort = parsed.sort;
                if (parsed.projection !== undefined) findOptions.projection = parsed.projection;
                if (parsed.limit !== undefined) findOptions.limit = parsed.limit;
                if (parsed.skip !== undefined) findOptions.skip = parsed.skip;

                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);

                const explainResult = await collection
                    .find(parsedQuery, findOptions)
                    .explain('executionStats');

                const indexesStats = await collection.aggregate([{ $indexStats: {} }]).toArray();
                const collectionStats = await client.db(db_name).command({ collStats: collection_name });

                // Compute metrics-only analysis from explain result
                const analysis = analyzeFindExplain(explainResult);
                const response = {
                    query: parsedQuery,
                    applied_options: findOptions,
                    metrics: analysis.metrics,
                    plan_shape: analysis.shape,
                    indexes_stats: indexesStats,
                    collection_stats: collectionStats,
                    explain: explainResult
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

    // List databases for generation tool
    server.registerTool("list_databases_for_generation",
        {
            title: "List Databases for Generation",
            description: "List all databases with basic info for query generation purposes"
        },
        async () => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const adminDb = client.db().admin();
                const databaseInfos = await adminDb.listDatabases();

                const response = {
                    databases: databaseInfos.databases.map(db => ({
                        name: db.name,
                        sizeOnDisk: db.sizeOnDisk,
                        empty: db.empty
                    }))
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

    // Get database info for generation tool
    server.registerTool("get_db_info_for_generation",
        {
            title: "Get Database Info for Generation",
            description: "Get detailed database information for query generation, including collections, sample documents and schema",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                include_sample_documents: z.union([z.boolean(), z.string()]).default(true).describe("Include sample documents from collections (boolean or boolean-like string)"),
                sample_size: z.union([z.number(), z.string()]).default(3).describe("Number of sample documents per collection (number or numeric string)")
            }
        },
    async ({ db_name, include_sample_documents = true, sample_size = 3 }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const collections = await db.listCollections().toArray();
        const { value: includeSamples } = parseParam<boolean>(include_sample_documents, 'boolean', { fieldName: 'include_sample_documents', defaultValue: true });
        const { value: sampleSize } = parseParam<number>(sample_size, 'int', { fieldName: 'sample_size', nonNegative: true, defaultValue: 3 });
                
                const collectionInfos = await Promise.all(
                    collections.map(async (collection) => {
                        try {
                            const count = await db.collection(collection.name).estimatedDocumentCount();
                            let sampleDocuments: any[] = [];
                            
                            if (includeSamples && count > 0) {
                                const pipeline = [{ $sample: { size: Math.min(sampleSize, count) } }];
                                sampleDocuments = await db.collection(collection.name).aggregate(pipeline).toArray();
                            }

                            return { 
                                name: collection.name, 
                                count,
                                sampleDocuments: includeSamples ? sampleDocuments : undefined
                            };
                        } catch (error) {
                            return { 
                                name: collection.name, 
                                count: 0, 
                                error: error instanceof Error ? error.message : String(error),
                                sampleDocuments: includeSamples ? [] : undefined
                            };
                        }
                    })
                );

                const dbInfo = {
                    database_name: db_name,
                    collections: collectionInfos,
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(dbInfo, null, 2),
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
}