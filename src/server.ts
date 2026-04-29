/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';

import { config } from './config';
import { getRequestPrincipal, requireHttpAuthentication } from './security/auth';
import { runWithRequestContext } from './security/requestContext';
import { registerCollectionTools } from './tools/collection-tools';
import { registerDatabaseTools } from './tools/database-tools';
import { registerDocumentTools } from './tools/document-tools';
import { registerIndexTools } from './tools/index-tools';

export function createServer(): McpServer {
    const server = new McpServer({
        name: 'documentdb-mcp-server',
        version: '0.1.0',
    });

    registerDatabaseTools(server);
    registerCollectionTools(server);
    registerDocumentTools(server);
    registerIndexTools(server);

    return server;
}

export async function runStdioServer(): Promise<void> {
    if (config.auth.required && !config.allowUnauthenticatedStdio) {
        throw new Error('stdio transport is disabled when AUTH_REQUIRED=true. Set ALLOW_UNAUTHENTICATED_STDIO=true only for trusted local development.');
    }

    const server = createServer();

    const cleanup = () => {
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception:', error);
        cleanup();
    });
    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled rejection:', reason);
        cleanup();
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('DocumentDB MCP Server running on stdio transport');
}

export async function runHttpServer(): Promise<void> {
    const app = express();
    app.use(express.json());
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    app.all('/mcp', requireHttpAuthentication(), async (req: Request, res: Response) => {
        console.error(`Received ${req.method} request to /mcp`);

        try {
            await runWithRequestContext(
                {
                    principal: getRequestPrincipal(req),
                    transport: 'streamable-http',
                    sessionId: req.headers['mcp-session-id'] as string | undefined,
                    requestId: req.headers['x-request-id'] as string | undefined,
                },
                async () => {
                    const sessionId = req.headers['mcp-session-id'] as string | undefined;
                    let transport: StreamableHTTPServerTransport;

                    if (sessionId && transports[sessionId]) {
                        transport = transports[sessionId];
                    } else if (!sessionId && req.method === 'POST' && req.body?.method === 'initialize') {
                        transport = new StreamableHTTPServerTransport({
                            sessionIdGenerator: () => randomUUID(),
                            onsessioninitialized: (initializedSessionId: string) => {
                                console.error(`Session initialized with ID: ${initializedSessionId}`);
                                transports[initializedSessionId] = transport;
                            },
                            onsessionclosed: (closedSessionId: string | undefined) => {
                                if (closedSessionId && transports[closedSessionId]) {
                                    console.error(`Session closed: ${closedSessionId}`);
                                    delete transports[closedSessionId];
                                }
                            },
                        });

                        transport.onclose = () => {
                            const sid = transport.sessionId;
                            if (sid && transports[sid]) {
                                console.error(`Transport closed for session ${sid}`);
                                delete transports[sid];
                            }
                        };

                        const server = createServer();
                        await server.connect(transport);
                    } else {
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

                    await transport.handleRequest(req, res, req.body);
                },
            );
        } catch (error) {
            console.error('Error handling MCP request:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null,
                });
            }
        }
    });

    const cleanup = async () => {
        console.error('Shutting down HTTP server...');
        for (const sessionId of Object.keys(transports)) {
            try {
                console.error(`Closing transport for session ${sessionId}`);
                await transports[sessionId].close();
            } catch (error) {
                console.error(`Error closing transport for session ${sessionId}:`, error);
            }
            delete transports[sessionId];
        }
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

    const httpServer = app.listen(config.port, config.host, () => {
        console.error(`DocumentDB MCP Server running on http://${config.host}:${config.port}/mcp`);
        console.error('Supported methods: GET, POST, DELETE');
    });

    return new Promise((resolve, reject) => {
        httpServer.on('error', reject);
        httpServer.on('listening', () => resolve());
    });
}

export async function runServer(): Promise<void> {
    if (config.transport === 'streamable-http') {
        await runHttpServer();
    } else if (config.transport === 'sse') {
        await runSseServer();
    } else {
        await runStdioServer();
    }
}

export async function runSseServer(): Promise<void> {
    const app = express();
    app.use(express.json());

    const transports: Record<string, SSEServerTransport> = {};

    app.get('/sse', requireHttpAuthentication(), async (req: Request, res: Response) => {
        try {
            await runWithRequestContext(
                {
                    principal: getRequestPrincipal(req),
                    transport: 'sse',
                    requestId: req.headers['x-request-id'] as string | undefined,
                },
                async () => {
                    const transport = new SSEServerTransport('/sse/messages', res);
                    transports[transport.sessionId] = transport;
                    transport.onclose = () => {
                        const sid = transport.sessionId;
                        if (transports[sid]) {
                            delete transports[sid];
                            console.error(`SSE session closed: ${sid}`);
                        }
                    };
                    const server = createServer();
                    await server.connect(transport);
                    console.error(`SSE session started: ${transport.sessionId}`);
                },
            );
        } catch (error) {
            console.error('Failed to start SSE session', error);
            if (!res.headersSent) res.status(500).end('Failed to start SSE session');
        }
    });

    app.post('/sse/messages', requireHttpAuthentication(), async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            res.status(400).end('Invalid or missing sessionId');
            return;
        }
        const transport = transports[sessionId];
        try {
            await runWithRequestContext(
                {
                    principal: getRequestPrincipal(req),
                    transport: 'sse',
                    sessionId,
                    requestId: req.headers['x-request-id'] as string | undefined,
                },
                async () => transport.handlePostMessage(req as any, res as any, req.body),
            );
        } catch (error) {
            console.error('Error handling SSE message', error);
            if (!res.headersSent) res.status(500).end('Error handling message');
        }
    });

    const cleanup = async () => {
        console.error('Shutting down SSE server...');
        for (const sessionId of Object.keys(transports)) {
            try {
                await transports[sessionId].close();
            } catch {}
            delete transports[sessionId];
        }
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

    const sseServer = app.listen(config.port, config.host, () => {
        console.error(`DocumentDB MCP Server (SSE) running at http://${config.host}:${config.port}/sse`);
        console.error('SSE endpoints: GET /sse, POST /sse/messages?sessionId=...');
    });

    return new Promise((resolve, reject) => {
        sseServer.on('error', reject);
        sseServer.on('listening', () => resolve());
    });
}
