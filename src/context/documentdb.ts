/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import { type DocumentDBContext } from '../models';
import { config } from '../config';

/**
 * Global MongoDB client instance and connection info
 */
let mongoClient: MongoClient | null = null;
let currentConnectionString: string | null = null;
let connectionStartTime: Date | null = null;

/**
 * Initialize MongoDB client connection using default config
 */
export async function initializeDocumentDBContext(): Promise<DocumentDBContext> {
    if (!mongoClient) {
        mongoClient = new MongoClient(config.documentDbUri);
        await mongoClient.connect();
        currentConnectionString = config.documentDbUri;
        connectionStartTime = new Date();
    }
    return {
        client: mongoClient,
    };
}

/**
 * Connect to MongoDB with a specific connection string
 */
export async function connectToDocumentDB(connectionString: string, testConnection: boolean = true): Promise<{
    success: boolean;
    message: string;
    connection_string: string;
    connected_at: string;
    server_info?: any;
}> {
    try {
        // Close existing connection if any
        if (mongoClient) {
            await mongoClient.close();
            mongoClient = null;
        }

        // Create new connection
        mongoClient = new MongoClient(connectionString);
        await mongoClient.connect();
        currentConnectionString = connectionString;
        connectionStartTime = new Date();

        let serverInfo;
        if (testConnection) {
            // Test the connection by getting server info
            const adminDb = mongoClient.db().admin();
            serverInfo = await adminDb.serverInfo();
        }

        return {
            success: true,
            message: 'Successfully connected to MongoDB',
            connection_string: connectionString,
            connected_at: connectionStartTime.toISOString(),
            server_info: testConnection ? serverInfo : undefined
        };
    } catch (error) {
        // Clean up on error
        if (mongoClient) {
            try {
                await mongoClient.close();
            } catch (closeError) {
                // Ignore close errors
            }
            mongoClient = null;
            currentConnectionString = null;
            connectionStartTime = null;
        }
        
        throw error;
    }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectFromDocumentDB(): Promise<{
    success: boolean;
    message: string;
    was_connected: boolean;
    connection_duration?: string;
}> {
    const wasConnected = mongoClient !== null;
    let connectionDuration: string | undefined;

    if (mongoClient && connectionStartTime) {
        const duration = Date.now() - connectionStartTime.getTime();
        connectionDuration = `${Math.round(duration / 1000)} seconds`;
    }

    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
        currentConnectionString = null;
        connectionStartTime = null;
    }

    return {
        success: true,
        message: wasConnected ? 'Disconnected from MongoDB' : 'No active connection to disconnect',
        was_connected: wasConnected,
        connection_duration: connectionDuration
    };
}

/**
 * Get current connection status
 */
export async function getConnectionStatus(): Promise<{
    connected: boolean;
    connection_string?: string;
    connected_at?: string;
    connection_duration?: string;
    server_info?: any;
}> {
    if (!mongoClient || !currentConnectionString || !connectionStartTime) {
        return {
            connected: false
        };
    }

    try {
        // Test if connection is still alive
        await mongoClient.db().admin().ping();
        
        const duration = Date.now() - connectionStartTime.getTime();
        const connectionDuration = `${Math.round(duration / 1000)} seconds`;

        // Get server info
        const serverInfo = await mongoClient.db().admin().serverInfo();

        return {
            connected: true,
            connection_string: currentConnectionString,
            connected_at: connectionStartTime.toISOString(),
            connection_duration: connectionDuration,
            server_info: serverInfo
        };
    } catch (error) {
        // Connection is dead, clean up
        mongoClient = null;
        currentConnectionString = null;
        connectionStartTime = null;
        
        return {
            connected: false
        };
    }
}

/**
 * Close MongoDB client connection
 */
export async function closeDocumentDBContext(): Promise<void> {
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
        currentConnectionString = null;
        connectionStartTime = null;
    }
}

/**
 * Get current DocumentDB context
 */
export function getDocumentDBContext(): DocumentDBContext {
    if (!mongoClient) {
        throw new Error('DocumentDB context not initialized. Call initializeDocumentDBContext() or use connect_mongodb tool first.');
    }
    return {
        client: mongoClient,
    };
}

/**
 * Create a context wrapper for MCP server with client parameter
 */
export function createDocumentDBContextWrapper(client?: MongoClient): DocumentDBContext {
    if (client) {
        return {
            client: client,
        };
    }
    
    return getDocumentDBContext();
}