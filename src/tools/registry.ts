/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type MongoClient } from 'mongodb';
import { type ZodRawShape } from 'zod';

import { type ToolRole } from '../config';
import { withDbGuard } from './utils/dbGuard';
import { type SecureToolInput } from './utils/toolSecurity';

/**
 * A declarative description of a single MCP tool exposed by this server.
 *
 * Adding a new tool only requires:
 *   1. Authoring a `ToolDefinition` (name, title, description, role, schema, handler).
 *   2. Adding the definition to the relevant category array (or to a new array
 *      that is then re-exported from {@link allToolDefinitions} in `src/tools/index.ts`).
 *
 * The {@link registerToolDefinitions} helper takes care of:
 *   - Wiring the handler through {@link withDbGuard}, which enforces capability checks,
 *     authorization, per-profile resource scope, pipeline-namespace scope, full-collection
 *     write protection and audit logging.
 *   - Calling `server.registerTool` with the standard `{ title, description, inputSchema }`
 *     descriptor expected by the MCP SDK.
 *
 * Handlers therefore never have to import `withDbGuard` themselves and the tool name only
 * appears in one place (the definition's `name` field).
 */
export interface ToolDefinition<Input extends SecureToolInput = any> {
    /** Unique tool identifier exposed over MCP (e.g. `find_documents`). */
    name: string;
    /** Human-readable short title shown in tool listings. */
    title: string;
    /** Long-form description used by MCP clients to decide when to invoke the tool. */
    description: string;
    /** Capability tier required to invoke this tool. Drives RBAC + per-profile checks. */
    requiredRole: ToolRole;
    /** Zod raw shape passed to `server.registerTool` as `inputSchema`. */
    inputSchema: ZodRawShape;
    /**
     * Business logic for the tool. Receives the parsed input and a connected `MongoClient`.
     * Errors thrown here are converted into a structured MCP error response by `withDbGuard`.
     *
     * Note: the default `Input` generic is `any` so that handlers can destructure tool-specific
     * fields (e.g. `sample_size`, `pipeline`, `update`) without restating them in a per-tool
     * input interface. Pass an explicit type parameter to opt into stricter checking.
     */
    handler: (input: Input, client: MongoClient) => Promise<unknown> | unknown;
}

/**
 * Identity helper that preserves the per-tool input generic for editor type-checking while
 * keeping the call site declarative. Equivalent to writing the object literal directly, but
 * surfaces type errors at the definition rather than at the registration site.
 */
export function defineTool<Input extends SecureToolInput = any>(
    def: ToolDefinition<Input>,
): ToolDefinition<Input> {
    return def;
}

/**
 * Register a batch of tool definitions on an MCP server. Wraps each handler in
 * {@link withDbGuard} so security policy is applied uniformly.
 */
export function registerToolDefinitions(
    server: McpServer,
    definitions: ReadonlyArray<ToolDefinition<any>>,
): void {
    for (const def of definitions) {
        const guardedHandler = withDbGuard(
            { toolName: def.name, requiredRole: def.requiredRole },
            def.handler as (input: SecureToolInput, client: MongoClient) => Promise<unknown> | unknown,
        );
        server.registerTool(
            def.name,
            {
                title: def.title,
                description: def.description,
                inputSchema: def.inputSchema,
            },
            // The MCP SDK types the handler as `(args: Record<string, any>) => ...` while
            // `withDbGuard` keeps a stricter `SecureToolInput` view. The runtime shape is
            // identical (both come from the same Zod-parsed input), so cast through `any`.
            guardedHandler as any,
        );
    }
}
