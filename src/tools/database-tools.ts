/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getProfileScope } from '../security/connectionProfiles';
import { defineTool, registerToolDefinitions, type ToolDefinition } from './registry';
import { assertDestructiveConfirmation } from './utils/confirmations';
import { serializeResponse } from './utils/limits';
import { connectionProfileSchema } from './utils/toolSecurity';

export const databaseToolDefinitions: ToolDefinition[] = [
    defineTool({
        name: 'list_databases',
        title: 'List Databases',
        description:
            'List all databases on the cluster. If db_name is provided, return that database collections with estimated document counts.',
        requiredRole: 'read',
        inputSchema: {
            connection_profile: connectionProfileSchema,
            db_name: z
                .string()
                .optional()
                .describe(
                    'Optional database name. When provided, returns collections and counts for this database only.',
                ),
        },
        handler: async ({ connection_profile, db_name }, client) => {
            const scope = getProfileScope(connection_profile);
            const allowedDbs = scope.allowedDatabases;
            const deniedDbs = scope.deniedDatabases;
            // Field semantics: undefined = unrestricted, [] = explicit deny-all, [...] = narrow to listed.
            // Denylist wins over allowlist.
            const dbAllowed = (name: string) => {
                if (deniedDbs && deniedDbs.includes(name)) return false;
                return allowedDbs === undefined || allowedDbs.includes(name);
            };
            const collectionAllowed = (db: string, collectionName: string) => {
                const deniedPerDb = scope.deniedCollections?.[db];
                if (deniedPerDb && deniedPerDb.includes(collectionName)) return false;
                const perDb = scope.allowedCollections?.[db];
                return perDb === undefined || perDb.includes(collectionName);
            };

            if (!db_name) {
                const databaseInfos = await client.db().admin().listDatabases();
                const response = {
                    databases: databaseInfos.databases
                        .filter((db) => dbAllowed(db.name))
                        .map((db) => ({
                            name: db.name,
                            sizeOnDisk: db.sizeOnDisk,
                            empty: db.empty,
                        })),
                };
                return serializeResponse(response);
            }

            const db = client.db(db_name);
            const collections = await db.listCollections().toArray();
            const collectionInfos = await Promise.all(
                collections
                    .filter((collection) => collectionAllowed(db_name, collection.name))
                    .map(async (collection) => {
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
            return serializeResponse({ database_name: db_name, collections: collectionInfos });
        },
    }),

    defineTool({
        name: 'drop_database',
        title: 'Drop Database',
        description:
            'Drop a database and all its collections. Requires confirm_db_name to exactly equal db_name.',
        requiredRole: 'management',
        inputSchema: {
            connection_profile: connectionProfileSchema,
            db_name: z.string().describe('Name of the database to drop'),
            confirm_db_name: z
                .string()
                .describe('Must exactly equal db_name. Confirms the destructive drop_database operation.'),
        },
        handler: async ({ db_name, confirm_db_name }, client) => {
            assertDestructiveConfirmation('confirm_db_name', db_name, confirm_db_name);
            const result = await client.db(db_name).dropDatabase();
            const response = {
                success: true,
                message: `Database '${db_name}' dropped successfully`,
                data: result,
            };
            return serializeResponse(response);
        },
    }),
];

export function registerDatabaseTools(server: McpServer): void {
    registerToolDefinitions(server, databaseToolDefinitions);
}
