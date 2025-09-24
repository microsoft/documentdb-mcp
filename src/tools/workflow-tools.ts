/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register workflow-related tools
 */
export function registerWorkflowTools(server: McpServer): void {
    // Optimize find query tool
    server.registerTool("optimize_find_query",
        {
            title: "Optimize Find Query",
            description: "Optimize a find query by analyzing index usage and suggesting improvements",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.record(z.unknown()).describe("MongoDB find query to optimize")
            }
        },
        async ({ db_name, collection_name, query }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                
                // Get query execution plan
                const explainResult = await collection.find(query).explain('executionStats');

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(explainResult, null, 2),
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
                include_sample_documents: z.boolean().default(true).describe("Include sample documents from collections"),
                sample_size: z.number().default(3).describe("Number of sample documents per collection")
            }
        },
        async ({ db_name, include_sample_documents = true, sample_size = 3 }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const collections = await db.listCollections().toArray();
                
                const collectionInfos = await Promise.all(
                    collections.map(async (collection) => {
                        try {
                            const count = await db.collection(collection.name).estimatedDocumentCount();
                            let sampleDocuments: any[] = [];
                            
                            if (include_sample_documents && count > 0) {
                                const pipeline = [{ $sample: { size: Math.min(sample_size, count) } }];
                                sampleDocuments = await db.collection(collection.name).aggregate(pipeline).toArray();
                            }

                            return { 
                                name: collection.name, 
                                count,
                                sampleDocuments: include_sample_documents ? sampleDocuments : undefined
                            };
                        } catch (error) {
                            return { 
                                name: collection.name, 
                                count: 0, 
                                error: error instanceof Error ? error.message : String(error),
                                sampleDocuments: include_sample_documents ? [] : undefined
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