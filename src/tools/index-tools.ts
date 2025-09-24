/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register index-related tools
 */
export function registerIndexTools(server: McpServer): void {
    // Create index tool
    server.registerTool("create_index",
        {
            title: "Create Index",
            description: "Create an index on a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                keys: z.record(z.unknown()).describe("Index key specification (JSON object)"),
                options: z.record(z.unknown()).default({}).describe("Index options (e.g., {unique: true, name: \"custom_name\"})")
            }
        },
        async ({ db_name, collection_name, keys, options = {} }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.createIndex(keys as any, options as any);

                const response = {
                    index_name: result,
                    keys,
                    options,
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

    // List indexes tool
    server.registerTool("list_indexes",
        {
            title: "List Indexes",
            description: "List all indexes on a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection")
            }
        },
        async ({ db_name, collection_name }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const indexes = await collection.listIndexes().toArray();

                const response = {
                    indexes,
                    count: indexes.length,
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

    // Drop index tool
    server.registerTool("drop_index",
        {
            title: "Drop Index",
            description: "Drop an index from a collection",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                index_name: z.string().describe("Name of the index to drop")
            }
        },
        async ({ db_name, collection_name, index_name }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const result = await collection.dropIndex(index_name);

                const successResponse = {
                    success: true,
                    message: `Index '${index_name}' dropped successfully`,
                    data: result,
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(successResponse, null, 2),
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

    // Index stats tool
    server.registerTool("index_stats",
        {
            title: "Index Statistics",
            description: "Get statistics for indexes on a collection",
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
                const stats = await db.command({
                    collStats: collection_name,
                    indexDetails: true,
                });

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

    // Current operations tool
    server.registerTool("current_ops",
        {
            title: "Current Operations",
            description: "Get current operations running on the database",
            inputSchema: {
                db_name: z.string().describe("Name of the database")
            }
        },
        async ({ db_name }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const operations = await db.admin().command({ currentOp: 1 });

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(operations, null, 2),
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