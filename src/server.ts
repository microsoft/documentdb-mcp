/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';


import { initializeDocumentDBContext, closeDocumentDBContext } from './context/documentdb';
import { config } from './config.js';

/**
 * Create and configure the MCP server
 */
export function createServer(): McpServer {
    const server = new McpServer({
        name: 'documentdb-mcp-server',
        version: '0.1.0'
    });

    // Register database tools
    registerDatabaseTools(server);
    
    // Register collection tools
    registerCollectionTools(server);
    
    // Register document tools
    registerDocumentTools(server);

    // Register workflow tools
    registerWorkflowTools(server);
    
    return server;
}

/**
 * Register database-related tools
 */
function registerDatabaseTools(server: McpServer): void {
    // List databases tool
    server.registerTool("list_databases",
        {
            title: "List Databases",
            description: "List all databases in the DocumentDB instance"
        },
        async () => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const adminDb = client.db().admin();
                const databaseInfos = await adminDb.listDatabases();
                const databaseNames = databaseInfos.databases.map((db) => db.name);

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(databaseNames, null, 2),
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

    // Database stats tool
    server.registerTool("db_stats",
        {
            title: "Database Statistics",
            description: "Get detailed statistics about a database's size and storage usage",
            inputSchema: {
                db_name: z.string().describe("Name of the database")
            }
        },
        async ({ db_name }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const stats = await db.stats();

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(stats, null, 2),
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

    // Get database info tool
    server.registerTool("get_db_info",
        {
            title: "Get Database Info",
            description: "Get database information including all collections and their document counts",
            inputSchema: {
                db_name: z.string().describe("Name of the database")
            }
        },
        async ({ db_name }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const collections = await db.listCollections().toArray();
                
                const collectionInfos = await Promise.all(
                    collections.map(async (collection) => {
                        try {
                            const count = await db.collection(collection.name).estimatedDocumentCount();
                            return { name: collection.name, count };
                        } catch (error) {
                            return { name: collection.name, count: 0, error: error instanceof Error ? error.message : String(error) };
                        }
                    })
                );

                const dbInfo = {
                    database_name: db_name,
                    collections: collectionInfos,
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(dbInfo, null, 2),
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

    // Drop database tool
    server.registerTool("drop_database",
        {
            title: "Drop Database",
            description: "Drop a database and all its collections",
            inputSchema: {
                db_name: z.string().describe("Name of the database to drop")
            }
        },
        async ({ db_name }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const result = await db.dropDatabase();

                const successResponse = {
                    success: true,
                    message: `Database '${db_name}' dropped successfully`,
                    data: result,
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(successResponse, null, 2),
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

/**
 * Register collection-related tools
 */
function registerCollectionTools(server: McpServer): void {
    // Collection stats tool
    server.registerTool("collection_stats",
        {
            title: "Collection Statistics",
            description: "Get detailed statistics about a collection's size and storage usage",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection")
            }
        },
        async ({ db_name, collection_name }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const stats = await db.command({ collStats: collection_name });

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(stats, null, 2),
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

    // Sample documents tool
    server.registerTool("sample_documents",
        {
            title: "Sample Documents",
            description: "Retrieve sample documents from specific collection. Useful for understanding data schema and query generation.",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                sample_size: z.number().default(10).describe("Number of documents to sample")
            }
        },
        async ({ db_name, collection_name, sample_size = 10 }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const pipeline = [{ $sample: { size: sample_size } }];
                const documents = await collection.aggregate(pipeline).toArray();

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(documents, null, 2),
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

/**
 * Register document-related tools
 */
function registerDocumentTools(server: McpServer): void {
    // Find documents tool
    server.registerTool("find_documents",
        {
            title: "Find Documents",
            description: "Find documents in a collection with optional query, projection, sort, limit, and skip",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.record(z.unknown()).default({}).describe("MongoDB query filter (JSON object)"),
                limit: z.number().default(100).describe("Maximum number of documents to return")
            }
        },
        async ({ db_name, collection_name, query = {}, limit = 100 }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);

                const documents = await collection.find(query).limit(limit).toArray();
                const totalCount = await collection.countDocuments(query);

                const response = {
                    documents,
                    total_count: totalCount,
                    limit,
                    returned_count: documents.length,
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(response, null, 2),
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

    // Count documents tool
    server.registerTool("count_documents",
        {
            title: "Count Documents",
            description: "Count documents in a collection matching a query",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.record(z.unknown()).default({}).describe("MongoDB query filter (JSON object)")
            }
        },
        async ({ db_name, collection_name, query = {} }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                const count = await collection.countDocuments(query);

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count, query }, null, 2),
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

/**
 * Register workflow-related tools
 */
function registerWorkflowTools(server: McpServer): void {
    // Optimize find query tool
    server.registerTool("optimize_find_query",
        {
            title: "Optimize Find Query",
            description: "Optimize a find query by analyzing index usage and suggesting improvements",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                collection_name: z.string().describe("Name of the collection"),
                query: z.record(z.unknown()).describe("MongoDB find query to optimize")
            }
        },
        async ({ db_name, collection_name, query }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const collection = client.db(db_name).collection(collection_name);
                
                // Get query execution plan
                const explainResult = await collection.find(query).explain('executionStats');

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(explainResult, null, 2),
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

    // List databases for generation tool
    server.registerTool("list_databases_for_generation",
        {
            title: "List Databases for Generation",
            description: "List all databases with basic info for query generation purposes"
        },
        async () => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const adminDb = client.db().admin();
                const databaseInfos = await adminDb.listDatabases();

                const response = {
                    databases: databaseInfos.databases.map(db => ({
                        name: db.name,
                        sizeOnDisk: db.sizeOnDisk,
                        empty: db.empty
                    }))
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(response, null, 2),
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

    // Get database info for generation tool
    server.registerTool("get_db_info_for_generation",
        {
            title: "Get Database Info for Generation",
            description: "Get detailed database information for query generation, including collections, sample documents and schema",
            inputSchema: {
                db_name: z.string().describe("Name of the database"),
                include_sample_documents: z.boolean().default(true).describe("Include sample documents from collections"),
                sample_size: z.number().default(3).describe("Number of sample documents per collection")
            }
        },
        async ({ db_name, include_sample_documents = true, sample_size = 3 }) => {
            try {
                const { getDocumentDBContext } = await import('./context/documentdb');
                const { client } = getDocumentDBContext();
                const db = client.db(db_name);
                const collections = await db.listCollections().toArray();
                
                const collectionInfos = await Promise.all(
                    collections.map(async (collection) => {
                        try {
                            const count = await db.collection(collection.name).estimatedDocumentCount();
                            let sampleDocuments: any[] = [];
                            
                            if (include_sample_documents && count > 0) {
                                const pipeline = [{ $sample: { size: Math.min(sample_size, count) } }];
                                sampleDocuments = await db.collection(collection.name).aggregate(pipeline).toArray();
                            }

                            return { 
                                name: collection.name, 
                                count,
                                sampleDocuments: include_sample_documents ? sampleDocuments : undefined
                            };
                        } catch (error) {
                            return { 
                                name: collection.name, 
                                count: 0, 
                                error: error instanceof Error ? error.message : String(error),
                                sampleDocuments: include_sample_documents ? [] : undefined
                            };
                        }
                    })
                );

                const dbInfo = {
                    database_name: db_name,
                    collections: collectionInfos,
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(dbInfo, null, 2),
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