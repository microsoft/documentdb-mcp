/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register document-related tools
 */
export function registerDocumentTools(server: McpServer): void {
    // Find documents tool
    server.registerTool("find_documents",
        {
            title: "Find Documents",
            description: "Find documents in a collection with optional query, projection, sort, limit, and skip",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.record(z.unknown()).default({}).describe("MongoDB query filter (JSON object)"),
                limit: z.number().default(100).describe("Maximum number of documents to return")
            }
        },
        async ({ db_name, collection_name, query = {}, limit = 100 }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);

                const documents = await collection.find(query).limit(limit).toArray();
                const totalCount = await collection.countDocuments(query);

                const response = {
                    documents,
                    total_count: totalCount,
                    limit,
                    returned_count: documents.length,
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
                collection_name: z.string().describe("Name of the collection"),
                query: z.record(z.unknown()).default({}).describe("MongoDB query filter (JSON object)")
            }
        },
        async ({ db_name, collection_name, query = {} }) => {
            try {
                const { getDocumentDBContext } = await import('../context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const count = await collection.countDocuments(query);

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count, query }, null, 2),
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