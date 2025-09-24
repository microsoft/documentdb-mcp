/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import { type DocumentDBContext, type DocumentDBContextNonableClient } from '../models';
import { config } from '../config';

/**
 * Global MongoDB client instance
 */
let mongoClient: MongoClient | null = null;

/**
 * Initialize MongoDB client connection
 */
export async function initializeDocumentDBContext(): Promise<DocumentDBContextNonableClient> {
    if (!mongoClient && config.documentDbUri && config.documentDbUri.trim() !== '') {
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
 */
export function getDocumentDBContext(): DocumentDBContext {
    if (!mongoClient && (!config.documentDbUri || config.documentDbUri.trim() === '')) {
        throw new Error('DocumentDB context not initialized. Call initializeDocumentDBContext() first.');
    }
    return {
        client: mongoClient as MongoClient,
    };
}

/**
 * Replace current MongoDB client with a new one using connection string
 * @param connectionString - MongoDB connection string
 */
export async function replaceClientWithConnectionString(connectionString: string): Promise<void> {
    console.log('Replacing MongoDB client with new connection string...');
    try {
        // Create new client with the provided connection string
        console.log('Creating new MongoDB client with provided connection string...');
        mongoClient = new MongoClient(connectionString);
        await mongoClient.connect();
        console.log('Successfully connected to MongoDB with new connection string');
    } catch (error) {
        console.error('Failed to connect with new connection string:', error);
        mongoClient = null;
        throw error;
    }
}

/**
 * Replace current MongoDB client with a provided MongoClient instance
 * @param client - MongoClient instance to use
 */
export async function replaceClientWithInstance(client: MongoClient): Promise<void> {
    console.log('Replacing MongoDB client with provided instance...');
    try {
        mongoClient = client;
        console.log('Successfully replaced MongoDB client with provided instance');
    } catch (error) {
        console.error('Failed to use provided MongoDB client instance:', error);
        mongoClient = null;
        throw error;
    }
}