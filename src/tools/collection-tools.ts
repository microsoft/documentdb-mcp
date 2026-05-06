/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../config';
import { assertDestructiveConfirmation } from './utils/confirmations';
import { withDbGuard } from './utils/dbGuard';
import { clampPositiveInt, maxTimeMSOption, serializeResponse } from './utils/limits';
import { parseParams } from './utils/paramParser';
import { connectionProfileSchema } from './utils/toolSecurity';

export function registerCollectionTools(server: McpServer): void {
    server.registerTool(
        'drop_collection',
        {
            title: 'Drop Collection',
            description:
                'Drop a collection from a database. Requires confirm_collection_name to exactly equal collection_name.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to drop'),
                confirm_collection_name: z
                    .string()
                    .describe(
                        'Must exactly equal collection_name. Confirms the destructive drop_collection operation.',
                    ),
            },
        },
        withDbGuard(
            { toolName: 'drop_collection', requiredRole: 'management' },
            async ({ db_name, collection_name, confirm_collection_name }, client) => {
                assertDestructiveConfirmation('confirm_collection_name', collection_name, confirm_collection_name);
                await client.db(db_name).dropCollection(collection_name);
                return serializeResponse({ message: 'Collection dropped successfully' });
            },
        ),
    );

    server.registerTool(
        'rename_collection',
        {
            title: 'Rename Collection',
            description: 'Rename a collection',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to rename'),
                new_collection_name: z.string().describe('New name for the collection'),
            },
        },
        withDbGuard(
            { toolName: 'rename_collection', requiredRole: 'management' },
            async ({ db_name, collection_name, new_collection_name }, client) => {
                await client.db(db_name).collection(collection_name).rename(new_collection_name, { dropTarget: false });
                return serializeResponse({ message: 'Collection renamed successfully' });
            },
        ),
    );

    server.registerTool(
        'sample_documents',
        {
            title: 'Sample Documents',
            description:
                'Retrieve sample documents from a collection. Useful for understanding data schema and query generation.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                sample_size: z
                    .union([z.number(), z.string()])
                    .default(10)
                    .describe('Number of documents to sample (number or numeric string)'),
            },
        },
        withDbGuard(
            { toolName: 'sample_documents', requiredRole: 'read' },
            async ({ db_name, collection_name, sample_size = 10 }, client) => {
                const parsed = parseParams([
                    {
                        raw: sample_size,
                        expected: 'int',
                        outKey: 'sample_size',
                        options: { fieldName: 'sample_size', nonNegative: true, defaultValue: 10 },
                    },
                ]);
                // Clamp sample size to MAX_SAMPLE_SIZE so a single call cannot scan unbounded data.
                const sampleSize = clampPositiveInt(parsed.sample_size as number, {
                    maxValue: config.limits.maxSampleSize,
                    defaultValue: 10,
                    fieldName: 'sample_size',
                });
                const documents = await client
                    .db(db_name)
                    .collection(collection_name)
                    .aggregate([{ $sample: { size: sampleSize } }], maxTimeMSOption())
                    .toArray();
                return serializeResponse(documents);
            },
        ),
    );

    server.registerTool(
        'current_ops',
        {
            title: 'Current Operations',
            description: 'Get information about current MongoDB operations',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                ops: z
                    .union([z.record(z.unknown()), z.string(), z.null()])
                    .optional()
                    .describe('Optional filter to narrow down the operations returned'),
            },
        },
        withDbGuard({ toolName: 'current_ops', requiredRole: 'management' }, async ({ ops = null }, client) => {
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
            return serializeResponse(response);
        }),
    );

    server.registerTool(
        'get_statistics',
        {
            title: 'Get Statistics',
            description:
                'Unified statistics tool. scope=database returns db.stats(); scope=collection returns collStats; scope=index returns $indexStats usage data.',
            inputSchema: {
                connection_profile: connectionProfileSchema,
                scope: z.enum(['database', 'collection', 'index']).describe('Which level of statistics to fetch'),
                db_name: z.string().describe('Name of the database'),
                collection_name: z
                    .string()
                    .optional()
                    .describe('Name of the collection; required when scope is collection or index'),
            },
        },
        withDbGuard(
            { toolName: 'get_statistics', requiredRole: 'read' },
            async ({ scope, db_name, collection_name }, client) => {
                const db = client.db(db_name);
                if (scope === 'database') {
                    const stats = await db.stats();
                    return serializeResponse(stats);
                }
                if (!collection_name) {
                    throw new Error('collection_name is required when scope is collection or index');
                }
                if (scope === 'collection') {
                    const stats = await db.command({ collStats: collection_name });
                    return serializeResponse(stats);
                }
                const stats = await db
                    .collection(collection_name)
                    .aggregate([{ $indexStats: {} }], maxTimeMSOption())
                    .toArray();
                return serializeResponse(stats);
            },
        ),
    );
}
