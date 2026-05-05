/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'dotenv/config';
import { readFileSync } from 'node:fs';

export type ToolRole = 'read' | 'write' | 'management';

export interface ConnectionProfileConfig {
    authMode?: 'connectionString' | 'entra';
    uri?: string;
    uriEnv?: string;
    endpoint?: string;
    tokenResource?: string;
    tokenScope?: string;
    username?: string;
    tls?: boolean;
    retryWrites?: boolean;
    appName?: string;
    allowedHosts?: string[];
}

export interface MCPConfig {
    transport: 'stdio' | 'sse' | 'streamable-http';
    host: string;
    port: number;
    auth: {
        required: boolean;
        tenantId: string;
        audience: string;
    };
    rateLimit: {
        enabled: boolean;
        windowMs: number;
        maxRequests: number;
    };
    authorization: {
        readRoleValues: string[];
        writeRoleValues: string[];
        managementRoleValues: string[];
    };
    capabilities: {
        readTools: boolean;
        writeTools: boolean;
        managementTools: boolean;
        allowWriteStagesInAggregate: boolean;
    };
    connectionProfiles: Record<string, ConnectionProfileConfig>;
    allowUnauthenticatedStdio: boolean;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function parseList(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseConnectionProfiles(
    value: string | undefined,
    filePath: string | undefined,
): Record<string, ConnectionProfileConfig> {
    const rawValue = value || (filePath ? readFileSync(filePath, 'utf8') : undefined);
    if (!rawValue) return {};
    try {
        const parsed = JSON.parse(rawValue) as Record<string, ConnectionProfileConfig>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('CONNECTION_PROFILES must be a JSON object');
        }
        return parsed;
    } catch (error) {
        throw new Error(
            `Invalid CONNECTION_PROFILES or CONNECTION_PROFILES_FILE: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function isLikelyMongoUri(value: string): boolean {
    return value.startsWith('mongodb://') || value.startsWith('mongodb+srv://');
}

function maybeSynthesizeDefaultProfile(
    profiles: Record<string, ConnectionProfileConfig>,
    connectionString: string | undefined,
): Record<string, ConnectionProfileConfig> {
    if (!connectionString) return profiles;
    const trimmed = connectionString.trim();
    if (!trimmed) return profiles;
    if (Object.keys(profiles).length > 0) {
        return profiles;
    }
    if (!isLikelyMongoUri(trimmed)) {
        throw new Error("DOCUMENTDB_MCP_CONNECTION_STRING must start with 'mongodb://' or 'mongodb+srv://'.");
    }
    console.error("DOCUMENTDB_MCP_CONNECTION_STRING detected; synthesized connection profile 'default'.");
    return {
        default: { authMode: 'connectionString', uri: trimmed },
    };
}

interface CliFlags {
    readOnly: boolean;
    stdio: boolean;
}

function parseCliFlags(argv: string[]): CliFlags {
    const flags: CliFlags = { readOnly: false, stdio: false };
    for (const arg of argv) {
        switch (arg) {
            case '--read-only':
            case '--readonly':
                flags.readOnly = true;
                break;
            case '--stdio':
                flags.stdio = true;
                break;
        }
    }
    return flags;
}

const cliFlags = parseCliFlags(process.argv.slice(2));

const baseConnectionProfiles = parseConnectionProfiles(
    process.env.CONNECTION_PROFILES,
    process.env.CONNECTION_PROFILES_FILE,
);
const effectiveConnectionProfiles = maybeSynthesizeDefaultProfile(
    baseConnectionProfiles,
    process.env.DOCUMENTDB_MCP_CONNECTION_STRING,
);

const transport: 'stdio' | 'sse' | 'streamable-http' = cliFlags.stdio
    ? 'stdio'
    : (process.env.TRANSPORT as 'stdio' | 'sse' | 'streamable-http') || 'streamable-http';

const authRequiredDefault = !(cliFlags.stdio && transport === 'stdio');
const allowUnauthStdioDefault = cliFlags.stdio && transport === 'stdio';

export const config: MCPConfig = {
    transport,
    host: process.env.HOST || 'localhost',
    port: parseInt(process.env.PORT || '8070', 10),
    auth: {
        required: parseBoolean(process.env.AUTH_REQUIRED, authRequiredDefault),
        tenantId: process.env.ENTRA_TENANT_ID || '',
        audience: process.env.ENTRA_AUDIENCE || process.env.ENTRA_CLIENT_ID || '',
    },
    rateLimit: {
        enabled: parseBoolean(process.env.RATE_LIMIT_ENABLED, true),
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '120', 10),
    },
    authorization: {
        readRoleValues: parseList(process.env.MCP_READ_ROLE_VALUES),
        writeRoleValues: parseList(process.env.MCP_WRITE_ROLE_VALUES),
        managementRoleValues: parseList(process.env.MCP_MANAGEMENT_ROLE_VALUES),
    },
    capabilities: {
        readTools: parseBoolean(process.env.ENABLE_READ_TOOLS, true),
        writeTools: cliFlags.readOnly ? false : parseBoolean(process.env.ENABLE_WRITE_TOOLS, false),
        managementTools: cliFlags.readOnly ? false : parseBoolean(process.env.ENABLE_MANAGEMENT_TOOLS, false),
        allowWriteStagesInAggregate: cliFlags.readOnly
            ? false
            : parseBoolean(process.env.ALLOW_AGGREGATE_WRITE_STAGES, false),
    },
    connectionProfiles: effectiveConnectionProfiles,
    allowUnauthenticatedStdio: parseBoolean(process.env.ALLOW_UNAUTHENTICATED_STDIO, allowUnauthStdioDefault),
};
