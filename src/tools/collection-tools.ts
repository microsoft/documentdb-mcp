/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { config } from '../config';
import { defineTool, registerToolDefinitions, type ToolDefinition } from './registry';
import { assertDestructiveConfirmation } from './utils/confirmations';
import { clampPositiveInt, maxTimeMSOption, serializeResponse } from './utils/limits';
import { parseParams } from './utils/paramParser';
import { connectionProfileSchema } from './utils/toolSecurity';

export const collectionToolDefinitions: ToolDefinition[] = [
    defineTool({
        name: 'drop_collection',
        title: 'Drop Collection',
        description:
            'Drop a collection from a database. Requires confirm_collection_name to exactly equal collection_name.',
        requiredRole: 'management',
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
        handler: async ({ db_name, collection_name, confirm_collection_name }, client) => {
            assertDestructiveConfirmation('confirm_collection_name', collection_name, confirm_collection_name);
            await client.db(db_name).dropCollection(collection_name);
            return serializeResponse({ message: 'Collection dropped successfully' });
        },
    }),

    defineTool({
        name: 'rename_collection',
        title: 'Rename Collection',
        description: 'Rename a collection',
        requiredRole: 'management',
        inputSchema: {
            connection_profile: connectionProfileSchema,
            db_name: z.string().describe('Name of the database'),
            collection_name: z.string().describe('Name of the collection to rename'),
            new_collection_name: z.string().describe('New name for the collection'),
        },
        handler: async ({ db_name, collection_name, new_collection_name }, client) => {
            await client.db(db_name).collection(collection_name).rename(new_collection_name, { dropTarget: false });
            return serializeResponse({ message: 'Collection renamed successfully' });
        },
    }),

    defineTool({
        name: 'sample_documents',
        title: 'Sample Documents',
        description:
            'Retrieve sample documents from a collection. Useful for understanding data schema and query generation.',
        requiredRole: 'read',
        inputSchema: {
            connection_profile: connectionProfileSchema,
            db_name: z.string().describe('Name of the database'),
            collection_name: z.string().describe('Name of the collection'),
            sample_size: z
                .union([z.number(), z.string()])
                .default(10)
                .describe('Number of documents to sample (number or numeric string)'),
        },
        handler: async ({ db_name, collection_name, sample_size = 10 }, client) => {
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
    }),

    defineTool({
        name: 'current_ops',
        title: 'Current Operations',
        description: 'Get information about current MongoDB operations',
        requiredRole: 'management',
        inputSchema: {
            connection_profile: connectionProfileSchema,
            ops: z
                .union([z.record(z.unknown()), z.string(), z.null()])
                .optional()
                .describe('Optional filter to narrow down the operations returned'),
        },
        handler: async ({ ops = null }, client) => {
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
        },
    }),

    defineTool({
        name: 'get_statistics',
        title: 'Get Statistics',
        description:
            'Unified statistics tool. scope=database returns db.stats(); scope=collection returns collStats; scope=index returns $indexStats usage data.',
        requiredRole: 'read',
        inputSchema: {
            connection_profile: connectionProfileSchema,
            scope: z.enum(['database', 'collection', 'index']).describe('Which level of statistics to fetch'),
            db_name: z.string().describe('Name of the database'),
            collection_name: z
                .string()
                .optional()
                .describe('Name of the collection; required when scope is collection or index'),
        },
        handler: async ({ scope, db_name, collection_name }, client) => {
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
    }),
];

export function registerCollectionTools(server: McpServer): void {
    registerToolDefinitions(server, collectionToolDefinitions);
}
