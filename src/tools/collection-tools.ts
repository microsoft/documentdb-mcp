/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register collection-related tools
 */
export function registerCollectionTools(server: McpServer): void {
    // Collection stats tool
    server.registerTool("collection_stats",
        {
            title: "Collection Statistics",
            description: "Get detailed statistics about a collection's size and storage usage",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection")
            }
        },
        async ({ db_name, collection_name }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const stats = await db.command({ collStats: collection_name });

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(stats, null, 2),
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

    // Sample documents tool
    server.registerTool("sample_documents",
        {
            title: "Sample Documents",
            description: "Retrieve sample documents from specific collection. Useful for understanding data schema and query generation.",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                sample_size: z.number().default(10).describe("Number of documents to sample")
            }
        },
        async ({ db_name, collection_name, sample_size = 10 }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const pipeline = [{ $sample: { size: sample_size } }];
                const documents = await collection.aggregate(pipeline).toArray();

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(documents, null, 2),
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