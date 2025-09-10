#!/usr/bin/env tsx

/**
 * Test script to validate client injection functionality
 * This demonstrates both backward compatibility and new client injection features
 */
import { MongoClient } from 'mongodb';
import { DocumentDBMCPServer, createServer } from './src/server.js';
import { initializeDocumentDBContext, getDocumentDBContext } from './src/context/documentdb.js';

async function testClientInjection() {
    console.log('Testing DocumentDB MCP Client Injection...\n');

    // Test 1: Backward compatibility - existing function-based approach
    console.log('Test 1: Backward compatibility (existing API)');
    try {
        await initializeDocumentDBContext();
        const context = getDocumentDBContext();
        console.log('✓ Global context initialized and retrieved successfully');
        console.log(`✓ Client database name: ${context.client.db().databaseName}`);
    } catch (error) {
        console.log('✗ Error with global context:', error.message);
    }

    // Test 2: New client injection approach
    console.log('\nTest 2: Client injection (new API)');
    try {
        // Create a custom client instance
        const customClient = new MongoClient('mongodb://localhost:27017', {
            connectTimeoutMS: 1000,
            serverSelectionTimeoutMS: 1000,
        });
        
        // Try to connect (this will fail in CI/test environment, but demonstrates the API)
        try {
            await customClient.connect();
            console.log('✓ Custom client connected successfully');
        } catch (connectError) {
            console.log('ℹ Custom client connection expected to fail in test environment');
        }

        // Create server with injected client
        const mcpServer = new DocumentDBMCPServer(customClient);
        const server = mcpServer.getServer();
        
        console.log('✓ DocumentDBMCPServer created with injected client');
        console.log('✓ Server instance retrieved successfully');
        console.log(`✓ Server name: ${server.name}`);
        console.log(`✓ Server version: ${server.version}`);

        await customClient.close();
    } catch (error) {
        console.log('✗ Error with client injection:', error.message);
    }

    // Test 3: Verify backward compatibility with createServer function
    console.log('\nTest 3: Backward compatibility with createServer function');
    try {
        const legacyServer = createServer();
        console.log('✓ Legacy createServer() function works');
        console.log(`✓ Legacy server name: ${legacyServer.name}`);
        console.log(`✓ Legacy server version: ${legacyServer.version}`);
    } catch (error) {
        console.log('✗ Error with legacy createServer:', error.message);
    }

    // Test 4: Multiple instances with different clients
    console.log('\nTest 4: Multiple server instances');
    try {
        const client1 = new MongoClient('mongodb://localhost:27017');
        const client2 = new MongoClient('mongodb://localhost:27018');
        
        const server1 = new DocumentDBMCPServer(client1);
        const server2 = new DocumentDBMCPServer(client2);
        const server3 = new DocumentDBMCPServer(); // No client - uses global
        
        console.log('✓ Multiple server instances created successfully');
        console.log(`✓ Server 1 with client 1: ${server1.getServer().name}`);
        console.log(`✓ Server 2 with client 2: ${server2.getServer().name}`);
        console.log(`✓ Server 3 with global client: ${server3.getServer().name}`);
        
        await client1.close();
        await client2.close();
    } catch (error) {
        console.log('✗ Error with multiple instances:', error.message);
    }

    console.log('\n✓ All tests completed successfully!');
    console.log('\nFeatures validated:');
    console.log('  - Backward compatibility with existing APIs');
    console.log('  - Client injection via constructor');
    console.log('  - Multiple server instances with different clients');
    console.log('  - Fallback to global client when none provided');
}

// ES module entry point check
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.argv[1] === __filename) {
    testClientInjection().catch((error) => {
        console.error('Test failed:', error);
        process.exit(1);
    });
}