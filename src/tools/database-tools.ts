/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { withDbGuard } from './utils/dbGuard';

const connectionSchema = z.string().describe('MongoDB/DocumentDB connection string for this stateless tool call');

export function registerDatabaseTools(server: McpServer): void {
    server.registerTool(
        'list_databases',
        {
            title: 'List Databases',
            description:
                'List all databases on the cluster. If db_name is provided, return that database collections with estimated document counts.',
            inputSchema: {
                connection_string: connectionSchema,
                db_name: z
                    .string()
                    .optional()
                    .describe(
                        'Optional database name. When provided, returns collections and counts for this database only.',
                    ),
            },
        },
        withDbGuard(async ({ db_name }, client) => {
            if (!db_name) {
                const databaseInfos = await client.db().admin().listDatabases();
                const response = {
                    databases: databaseInfos.databases.map((db) => ({
                        name: db.name,
                        sizeOnDisk: db.sizeOnDisk,
                        empty: db.empty,
                    })),
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            }

            const db = client.db(db_name);
            const collections = await db.listCollections().toArray();
            const collectionInfos = await Promise.all(
                collections.map(async (collection) => {
                    try {
                        const count = await db.collection(collection.name).estimatedDocumentCount();
                        return { name: collection.name, count };
                    } catch (error) {
                        return {
                            name: collection.name,
                            count: 0,
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                }),
            );
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ database_name: db_name, collections: collectionInfos }, null, 2),
                    },
                ],
            };
        }),
    );

    server.registerTool(
        'drop_database',
        {
            title: 'Drop Database',
            description: 'Drop a database and all its collections',
            inputSchema: {
                connection_string: connectionSchema,
                db_name: z.string().describe('Name of the database to drop'),
            },
        },
        withDbGuard(async ({ db_name }, client) => {
            const result = await client.db(db_name).dropDatabase();
            const response = {
                success: true,
                message: `Database '${db_name}' dropped successfully`,
                data: result,
            };
            return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
        }),
    );
}
