/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertDestructiveConfirmation } from './utils/confirmations';
import { withDbGuard } from './utils/dbGuard';
import { parseParams } from './utils/paramParser';
import { connectionProfileSchema } from './utils/toolSecurity';

export function registerIndexTools(server: McpServer): void {
    server.registerTool(
        'create_index',
        {
            title: 'Create Index',
            description: 'Create an index on a collection',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                keys: z
                    .union([z.record(z.unknown()), z.string()])
                    .describe('Index key specification, e.g. { field: 1 }'),
                options: z
                    .union([z.record(z.unknown()), z.string()])
                    .default({})
                    .describe("Index options, e.g. { unique: true, name: 'idx' }"),
            },
        },
        withDbGuard(
            { toolName: 'create_index', requiredRole: 'management' },
            async ({ db_name, collection_name, keys, options = {} }, client) => {
                const parsed = parseParams([
                    { raw: keys, expected: 'object', outKey: 'keys', options: { fieldName: 'keys' } },
                    { raw: options, expected: 'object', outKey: 'options', options: { fieldName: 'options' } },
                ]);
                const indexName = await client
                    .db(db_name)
                    .collection(collection_name)
                    .createIndex(parsed.keys as any, parsed.options as any);
                const response = { index_name: indexName, keys: parsed.keys, options: parsed.options };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            },
        ),
    );

    server.registerTool(
        'list_indexes',
        {
            title: 'List Indexes',
            description: 'List all indexes on a collection',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
            },
        },
        withDbGuard(
            { toolName: 'list_indexes', requiredRole: 'read' },
            async ({ db_name, collection_name }, client) => {
                const indexes = await client.db(db_name).collection(collection_name).listIndexes().toArray();
                return {
                    content: [{ type: 'text', text: JSON.stringify({ indexes, count: indexes.length }, null, 2) }],
                };
            },
        ),
    );

    server.registerTool(
        'drop_index',
        {
            title: 'Drop Index',
            description:
                'Drop an index from a collection. Requires confirm_index_name to exactly equal index_name.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                index_name: z.string().describe('Name of the index to drop'),
                confirm_index_name: z
                    .string()
                    .describe('Must exactly equal index_name. Confirms the destructive drop_index operation.'),
            },
        },
        withDbGuard(
            { toolName: 'drop_index', requiredRole: 'management' },
            async ({ db_name, collection_name, index_name, confirm_index_name }, client) => {
                assertDestructiveConfirmation('confirm_index_name', index_name, confirm_index_name);
                const result = await client.db(db_name).collection(collection_name).dropIndex(index_name);
                const response = { success: true, message: `Index '${index_name}' dropped successfully`, data: result };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            },
        ),
    );
}
