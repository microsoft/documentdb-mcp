/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import { type DocumentDBContext } from '../models';
import { config } from '../config';

/**
 * Global MongoDB client instance
 */
let mongoClient: MongoClient | null = null;

/**
 * Thread-local client instance for client injection
 */
let injectedClient: MongoClient | null = null;

/**
 * Set injected client for current context
 * @param client The client to set or null to clear
 * @returns The previous injected client value
 */
export function setInjectedClient(client: MongoClient | null): MongoClient | null {
    const previous = injectedClient;
    injectedClient = client;
    return previous;
}

/**
 * Initialize MongoDB client connection
 */
export async function initializeDocumentDBContext(): Promise<DocumentDBContext> {
    if (!mongoClient) {
        mongoClient = new MongoClient(config.documentDbUri);
        await mongoClient.connect();
    }
    return {
        client: mongoClient,
    };
}

/**
 * Close MongoDB client connection
 */
export async function closeDocumentDBContext(): Promise<void> {
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
    }
}

/**
 * Get current DocumentDB context
 * Prioritizes injected client over global client
 */
export function getDocumentDBContext(): DocumentDBContext {
    // Use injected client if available
    if (injectedClient) {
        return {
            client: injectedClient,
        };
    }
    
    // Fall back to global client
    if (!mongoClient) {
        throw new Error('DocumentDB context not initialized. Call initializeDocumentDBContext() first.');
    }
    return {
        client: mongoClient,
    };
}