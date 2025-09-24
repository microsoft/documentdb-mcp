/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register connection-related tools
 */
export function registerConnectionTools(server: McpServer): void {
    // Connect to MongoDB tool
    server.registerTool("connect_mongodb",
        {
            title: "Connect to MongoDB",
            description: "Connect to a MongoDB instance with a connection string",
            inputSchema: {
                connection_string: z.string().describe("MongoDB connection string (e.g., mongodb://localhost:27017)"),
                test_connection: z.boolean().default(true).describe("Test the connection after connecting")
            }
        },
        async ({ connection_string, test_connection = true }) => {
            try {
                const { connectToDocumentDB } = await import('../context/documentdb');
                const result = await connectToDocumentDB(connection_string, test_connection);

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
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

    // Disconnect from MongoDB tool
    server.registerTool("disconnect_mongodb",
        {
            title: "Disconnect from MongoDB",
            description: "Disconnect from the current MongoDB instance"
        },
        async () => {
            try {
                const { disconnectFromDocumentDB } = await import('../context/documentdb');
                const result = await disconnectFromDocumentDB();

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
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

    // Get connection status tool
    server.registerTool("get_connection_status",
        {
            title: "Get Connection Status",
            description: "Get the current MongoDB connection status and details"
        },
        async () => {
            try {
                const { getConnectionStatus } = await import('../context/documentdb');
                const status = await getConnectionStatus();

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(status, null, 2),
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