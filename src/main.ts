/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runServer } from './server';
import { config } from './config';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

async function ensureInstructionsFile(): Promise<void> {
    // Source and destination paths
    const repoRoot = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
    const sourceFile = path.join(repoRoot, 'documentdb_mcp.instructions.md');
    const targetDir = path.join(repoRoot, '.github', 'instructions');
    const targetFile = path.join(targetDir, 'documentdb_mcp.instructions.md');

    try {
        await fs.access(targetFile);
        return; // Already exists
    } catch {
        // Need to create
    }

    try {
        // Ensure source exists
        const content = await fs.readFile(sourceFile, 'utf8');
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(targetFile, content, 'utf8');
        console.info(`Created missing instructions file at ${targetFile}`);
    } catch (err) {
        console.warn('Could not ensure instructions file:', err);
    }
}

async function main(): Promise<void> {
    console.info(`Starting DocumentDB MCP server with transport: ${config.transport}`);
    try {
        await ensureInstructionsFile();
        await runServer();
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

const argvPath = path.resolve(process.argv[1]);
const importPath = fileURLToPath(import.meta.url);

if (argvPath === importPath) {
    main().catch((err) => {
        console.error("Unhandled error in main:", err);
        process.exit(1);
    });
}