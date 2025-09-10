/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';

// Import tools
import { 
    listDatabasesTool, 
    listDatabases, 
    dbStatsTool, 
    dbStats, 
    getDbInfoTool, 
    getDbInfo, 
    dropDatabaseTool, 
    dropDatabase 
} from './tools/database';
import { 
    collectionStatsTool, 
    collectionStats, 
    renameCollectionTool, 
    renameCollection, 
    dropCollectionTool, 
    dropCollection, 
    sampleDocumentsTool, 
    sampleDocuments 
} from './tools/collection';
import { 
    findDocumentsTool, 
    findDocuments, 
    countDocumentsTool, 
    countDocuments, 
    insertDocumentTool, 
    insertDocument, 
    insertManyTool, 
    insertMany, 
    updateDocumentTool, 
    updateDocument, 
    deleteDocumentTool, 
    deleteDocument, 
    aggregateTool, 
    aggregate 
} from './tools/document';
import { 
    createIndexTool, 
    createIndex, 
    listIndexesTool, 
    listIndexes, 
    dropIndexTool, 
    dropIndex, 
    indexStatsTool, 
    indexStats, 
    currentOpsTool, 
    currentOps 
} from './tools/index';
import { 
    optimizeFindQueryTool, 
    optimizeFindQuery, 
    optimizeAggregateQueryTool, 
    optimizeAggregateQuery, 
    listDatabasesForGenerationTool, 
    listDatabasesForGeneration, 
    getDbInfoForGenerationTool, 
    getDbInfoForGeneration 
} from './tools/workflow';

import { initializeDocumentDBContext, closeDocumentDBContext, setInjectedClient } from './context/documentdb';
import { config } from './config.js';
import { type MongoClient } from 'mongodb';

/**
 * DocumentDB MCP Server class that supports client injection
 */
export class DocumentDBMCPServer {
    private server: Server;
    private injectedClient: MongoClient | null;

    constructor(client?: MongoClient) {
        this.injectedClient = client || null;
        this.server = this.createServer();
    }

    /**
     * Get the underlying MCP server instance
     */
    getServer(): Server {
        return this.server;
    }

    /**
     * Create and configure the MCP server with injected client support
     */
    private createServer(): Server {
        const server = new Server(
            {
                name: 'documentdb-mcp-server',
                version: '0.1.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        // All available tools
        const tools = [
            // Database tools
            listDatabasesTool,
            dbStatsTool,
            getDbInfoTool,
            dropDatabaseTool,

            // Collection tools
            collectionStatsTool,
            renameCollectionTool,
            dropCollectionTool,
            sampleDocumentsTool,

            // Document tools
            findDocumentsTool,
            countDocumentsTool,
            insertDocumentTool,
            insertManyTool,
            updateDocumentTool,
            deleteDocumentTool,
            aggregateTool,

            // Index tools
            createIndexTool,
            listIndexesTool,
            dropIndexTool,
            indexStatsTool,
            currentOpsTool,

            // Workflow tools
            optimizeFindQueryTool,
            optimizeAggregateQueryTool,
            listDatabasesForGenerationTool,
            getDbInfoForGenerationTool,
        ];

        // Tool handlers mapping with client injection support
        const toolHandlers = new Map([
            // Database handlers
            ['list_databases', this.wrapHandler(listDatabases)],
            ['db_stats', this.wrapHandler(dbStats)],
            ['get_db_info', this.wrapHandler(getDbInfo)],
            ['drop_database', this.wrapHandler(dropDatabase)],

            // Collection handlers
            ['collection_stats', this.wrapHandler(collectionStats)],
            ['rename_collection', this.wrapHandler(renameCollection)],
            ['drop_collection', this.wrapHandler(dropCollection)],
            ['sample_documents', this.wrapHandler(sampleDocuments)],

            // Document handlers
            ['find_documents', this.wrapHandler(findDocuments)],
            ['count_documents', this.wrapHandler(countDocuments)],
            ['insert_document', this.wrapHandler(insertDocument)],
            ['insert_many', this.wrapHandler(insertMany)],
            ['update_document', this.wrapHandler(updateDocument)],
            ['delete_document', this.wrapHandler(deleteDocument)],
            ['aggregate', this.wrapHandler(aggregate)],

            // Index handlers
            ['create_index', this.wrapHandler(createIndex)],
            ['list_indexes', this.wrapHandler(listIndexes)],
            ['drop_index', this.wrapHandler(dropIndex)],
            ['index_stats', this.wrapHandler(indexStats)],
            ['current_ops', this.wrapHandler(currentOps)],

            // Workflow handlers
            ['optimize_find_query', this.wrapHandler(optimizeFindQuery)],
            ['optimize_aggregate_query', this.wrapHandler(optimizeAggregateQuery)],
            ['list_databases_for_generation', this.wrapHandler(listDatabasesForGeneration)],
            ['get_db_info_for_generation', this.wrapHandler(getDbInfoForGeneration)],
        ]);

        // Register list tools handler
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools,
            };
        });

        // Register call tool handler
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const toolName = request.params.name;
            const handler = toolHandlers.get(toolName);

            if (!handler) {
                throw new Error(`Unknown tool: ${toolName}`);
            }

            return await handler(request);
        });

        return server;
    }

    /**
     * Wrap a tool handler to set the injected client context
     */
    private wrapHandler(handler: (request: CallToolRequest) => Promise<CallToolResult>) {
        return async (request: CallToolRequest): Promise<CallToolResult> => {
            // Set the injected client context before calling the handler
            const previousClient = setInjectedClient(this.injectedClient);
            try {
                return await handler(request);
            } finally {
                // Restore previous client context
                setInjectedClient(previousClient);
            }
        };
    }
}

/**
 * Create and configure the MCP server (backward compatibility)
 */
export function createServer(): Server {
    const mcpServer = new DocumentDBMCPServer();
    return mcpServer.getServer();
}

/**
 * Run the server with stdio transport
 */
export async function runStdioServer(): Promise<void> {
    const server = createServer();

    // Initialize DocumentDB context
    await initializeDocumentDBContext();

    // Setup cleanup on process termination
    const cleanup = async () => {
        await closeDocumentDBContext();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', async (error) => {
        console.error('Uncaught exception:', error);
        await cleanup();
    });
    process.on('unhandledRejection', async (reason) => {
        console.error('Unhandled rejection:', reason);
        await cleanup();
    });

    // Create and run transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('DocumentDB MCP Server running on stdio transport');
}

/**
 * Run the server with streamable HTTP transport
 */
export async function runHttpServer(): Promise<void> {
    const app = express();
    app.use(express.json());

    // Configure CORS to expose Mcp-Session-Id header for browser-based clients
    app.use(cors({
        origin: '*', // Allow all origins - adjust as needed for production
        exposedHeaders: ['Mcp-Session-Id']
    }));

    // Store transports by session ID
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // Initialize DocumentDB context once
    await initializeDocumentDBContext();

    // Handle all MCP Streamable HTTP requests (GET, POST, DELETE)
    app.all('/mcp', async (req: Request, res: Response) => {
        console.error(`Received ${req.method} request to /mcp`);

        try {
            // Check for existing session ID
            const sessionId = req.headers['mcp-session-id'] as string | undefined;
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
                // Reuse existing transport
                transport = transports[sessionId];
            } else if (!sessionId && req.method === 'POST' && req.body?.method === 'initialize') {
                // Create new transport for initialization request
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sessionId: string) => {
                        console.error(`Session initialized with ID: ${sessionId}`);
                        transports[sessionId] = transport;
                    },
                    onsessionclosed: (sessionId: string | undefined) => {
                        if (sessionId && transports[sessionId]) {
                            console.error(`Session closed: ${sessionId}`);
                            delete transports[sessionId];
                        }
                    }
                });

                // Set up onclose handler to clean up transport when closed
                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid && transports[sid]) {
                        console.error(`Transport closed for session ${sid}`);
                        delete transports[sid];
                    }
                };

                // Connect the transport to the MCP server
                const server = createServer();
                await server.connect(transport);
            } else {
                // Invalid request
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Bad Request: No valid session ID provided or not an initialization request',
                    },
                    id: null,
                });
                return;
            }

            // Handle the request with the transport
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error('Error handling MCP request:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    });

    // Setup cleanup on process termination
    const cleanup = async () => {
        console.error('Shutting down HTTP server...');

        // Close all active transports
        for (const sessionId in transports) {
            try {
                console.error(`Closing transport for session ${sessionId}`);
                await transports[sessionId].close();
                delete transports[sessionId];
            } catch (error) {
                console.error(`Error closing transport for session ${sessionId}:`, error);
            }
        }

        await closeDocumentDBContext();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', async (error) => {
        console.error('Uncaught exception:', error);
        await cleanup();
    });
    process.on('unhandledRejection', async (reason) => {
        console.error('Unhandled rejection:', reason);
        await cleanup();
    });

    // Start the HTTP server
    const server = app.listen(config.port, config.host, () => {
        console.error(`DocumentDB MCP Server running on http://${config.host}:${config.port}/mcp`);
        console.error('Supported methods: GET, POST, DELETE');
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.on('listening', () => resolve());
    });
}

/**
 * Run the server with the specified transport
 */
export async function runServer(): Promise<void> {
    if (config.transport === 'streamable-http') {
        await runHttpServer();
    } else {
        await runStdioServer();
    }
}