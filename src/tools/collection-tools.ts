/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { withDbGuard } from './utils/dbGuard';
import { parseParams } from './utils/paramParser';

const connectionSchema = z.string().describe('MongoDB/DocumentDB connection string for this stateless tool call');

export function registerCollectionTools(server: McpServer): void {
    server.registerTool(
        'drop_collection',
        {
            title: 'Drop Collection',
            description: 'Drop a collection from a database',
            inputSchema: {
                connection_string: connectionSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to drop'),
            },
        },
        withDbGuard(async ({ db_name, collection_name }, client) => {
            await client.db(db_name).dropCollection(collection_name);
            return {
                content: [
                    { type: 'text', text: JSON.stringify({ message: 'Collection dropped successfully' }, null, 2) },
                ],
            };
        }),
    );

    server.registerTool(
        'rename_collection',
        {
            title: 'Rename Collection',
            description: 'Rename a collection',
            inputSchema: {
                connection_string: connectionSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to rename'),
                new_collection_name: z.string().describe('New name for the collection'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, new_collection_name }, client) => {
            await client.db(db_name).collection(collection_name).rename(new_collection_name, { dropTarget: false });
            return {
                content: [
                    { type: 'text', text: JSON.stringify({ message: 'Collection renamed successfully' }, null, 2) },
                ],
            };
        }),
    );

    server.registerTool(
        'sample_documents',
        {
            title: 'Sample Documents',
            description:
                'Retrieve sample documents from a collection. Useful for understanding data schema and query generation.',
            inputSchema: {
                connection_string: connectionSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                sample_size: z
                    .union([z.number(), z.string()])
                    .default(10)
                    .describe('Number of documents to sample (number or numeric string)'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, sample_size = 10 }, client) => {
            const parsed = parseParams([
                {
                    raw: sample_size,
                    expected: 'int',
                    outKey: 'sample_size',
                    options: { fieldName: 'sample_size', nonNegative: true, defaultValue: 10 },
                },
            ]);
            const documents = await client
                .db(db_name)
                .collection(collection_name)
                .aggregate([{ $sample: { size: parsed.sample_size as number } }])
                .toArray();
            return { content: [{ type: 'text', text: JSON.stringify(documents, null, 2) }] };
        }),
    );

    server.registerTool(
        'current_ops',
        {
            title: 'Current Operations',
            description: 'Get information about current MongoDB operations',
            inputSchema: {
                connection_string: connectionSchema,
                ops: z
                    .union([z.record(z.unknown()), z.string(), z.null()])
                    .optional()
                    .describe('Optional filter to narrow down the operations returned'),
            },
        },
        withDbGuard(async ({ ops = null }, client) => {
            const parsed = parseParams([
                {
                    raw: ops,
                    expected: 'object',
                    outKey: 'ops',
                    options: { fieldName: 'ops', optional: true, treatEmptyObjectAsUndefined: true },
                },
            ]);
            const command: Record<string, unknown> = { currentOp: true };
            if (parsed.ops) Object.assign(command, parsed.ops);
            const response = await client.db('admin').command(command as any);
            return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
        }),
    );

    server.registerTool(
        'get_statistics',
        {
            title: 'Get Statistics',
            description:
                'Unified statistics tool. scope=database returns db.stats(); scope=collection returns collStats; scope=index returns $indexStats usage data.',
            inputSchema: {
                connection_string: connectionSchema,
                scope: z.enum(['database', 'collection', 'index']).describe('Which level of statistics to fetch'),
                db_name: z.string().describe('Name of the database'),
                collection_name: z
                    .string()
                    .optional()
                    .describe('Name of the collection; required when scope is collection or index'),
            },
        },
        withDbGuard(async ({ scope, db_name, collection_name }, client) => {
            const db = client.db(db_name);
            if (scope === 'database') {
                const stats = await db.stats();
                return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            }
            if (!collection_name) {
                throw new Error('collection_name is required when scope is collection or index');
            }
            if (scope === 'collection') {
                const stats = await db.command({ collStats: collection_name });
                return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            }
            const stats = await db
                .collection(collection_name)
                .aggregate([{ $indexStats: {} }])
                .toArray();
            return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
        }),
    );
}
