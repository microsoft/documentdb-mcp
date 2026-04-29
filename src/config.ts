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

export const config: MCPConfig = {
    transport: (process.env.TRANSPORT as 'stdio' | 'sse' | 'streamable-http') || 'streamable-http',
    host: process.env.HOST || 'localhost',
    port: parseInt(process.env.PORT || '8070', 10),
    auth: {
        required: parseBoolean(process.env.AUTH_REQUIRED, true),
        tenantId: process.env.ENTRA_TENANT_ID || '',
        audience: process.env.ENTRA_AUDIENCE || process.env.ENTRA_CLIENT_ID || '',
    },
    authorization: {
        readRoleValues: parseList(process.env.MCP_READ_ROLE_VALUES),
        writeRoleValues: parseList(process.env.MCP_WRITE_ROLE_VALUES),
        managementRoleValues: parseList(process.env.MCP_MANAGEMENT_ROLE_VALUES),
    },
    capabilities: {
        readTools: parseBoolean(process.env.ENABLE_READ_TOOLS, true),
        writeTools: parseBoolean(process.env.ENABLE_WRITE_TOOLS, false),
        managementTools: parseBoolean(process.env.ENABLE_MANAGEMENT_TOOLS, false),
        allowWriteStagesInAggregate: parseBoolean(process.env.ALLOW_AGGREGATE_WRITE_STAGES, false),
    },
    connectionProfiles: parseConnectionProfiles(process.env.CONNECTION_PROFILES, process.env.CONNECTION_PROFILES_FILE),
    allowUnauthenticatedStdio: parseBoolean(process.env.ALLOW_UNAUTHENTICATED_STDIO, false),
};
