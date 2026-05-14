/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { collectionToolDefinitions } from './collection-tools';
import { databaseToolDefinitions } from './database-tools';
import { documentToolDefinitions } from './document-tools';
import { indexToolDefinitions } from './index-tools';
import { registerToolDefinitions, type ToolDefinition } from './registry';

export { defineTool, registerToolDefinitions } from './registry';
export type { ToolDefinition } from './registry';

/**
 * Single source of truth for every MCP tool exposed by the server.
 *
 * To add a new tool: create a `ToolDefinition` (or a category file that exports an array of
 * them) and append it here. No changes to `server.ts`, `withDbGuard`, or any test plumbing
 * are required — `registerAllTools` will pick it up automatically.
 */
export const allToolDefinitions: ReadonlyArray<ToolDefinition> = [
    ...databaseToolDefinitions,
    ...collectionToolDefinitions,
    ...documentToolDefinitions,
    ...indexToolDefinitions,
];

/**
 * Register every known tool definition on the supplied MCP server. This is the function
 * `server.ts` should call; per-category `registerXTools` helpers remain for back-compat
 * (tests that exercise a single category in isolation continue to work).
 */
export function registerAllTools(server: McpServer): void {
    registerToolDefinitions(server, allToolDefinitions);
}
