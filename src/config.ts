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
    /**
     * Optional allowlist of databases this profile may access.
     * Field semantics (uniform with `allowedRoles` / `allowedCollections`):
     *   - omitted (`undefined`) → all databases allowed
     *   - empty (`[]`)         → explicit deny-all (no databases pass through this profile)
     *   - listed (`[...]`)     → only the listed databases are allowed
     * Enforced before contacting the backend; non-matching `db_name` is rejected with an actionable error.
     */
    allowedDatabases?: string[];
    /**
     * Optional per-database collection allowlist.
     * Field semantics (uniform with `allowedRoles` / `allowedDatabases`):
     *   - `allowedCollections[db]` omitted    → all collections in that db are allowed (subject to `allowedDatabases`)
     *   - `allowedCollections[db]` is `[]`    → explicit deny-all collections in that db
     *   - `allowedCollections[db]` is `[...]` → only listed collections are allowed in that db
     */
    allowedCollections?: Record<string, string[]>;
    /**
     * Optional per-profile allowlist of tool capability tiers (read / write / management).
     * Field semantics (uniform with `allowedDatabases` / `allowedCollections`):
     *   - omitted (`undefined`) → documented default `["read"]` (read-only)
     *   - empty (`[]`)         → explicit deny-all (no tiers, not even read — the profile becomes unusable)
     *   - listed (`[...]`)     → exactly those tiers are permitted
     * This narrows what the profile permits; it never broadens global capability flags or the caller's role.
     */
    allowedRoles?: ToolRole[];
    /**
     * Optional per-profile blocklist of databases. Deny wins over `allowedDatabases`.
     * Field semantics:
     *   - omitted (`undefined`) → no databases are explicitly denied
     *   - empty (`[]`)         → no databases are explicitly denied (treated same as omitted)
     *   - listed (`[...]`)     → listed databases are denied even if otherwise allowed
     * Useful for "allow everything except these" patterns without enumerating every allowed db.
     */
    deniedDatabases?: string[];
    /**
     * Optional per-database collection blocklist. Deny wins over `allowedCollections`.
     * Field semantics:
     *   - `deniedCollections[db]` omitted    → no collections in that db are denied
     *   - `deniedCollections[db]` is `[]`    → no collections in that db are denied (same as omitted)
     *   - `deniedCollections[db]` is `[...]` → listed collections are denied even if otherwise allowed
     */
    deniedCollections?: Record<string, string[]>;
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
    limits: {
        maxFindLimit: number;
        maxSampleSize: number;
        maxInsertBatchSize: number;
        maxReturnBytes: number;
        mongoMaxTimeMs: number;
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

function parsePositiveInt(value: string | undefined, defaultValue: number, name: string): number {
    if (value === undefined || value === '') return defaultValue;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer (got '${value}').`);
    }
    return parsed;
}

/**
 * Hard ceilings imposed by the Azure DocumentDB / Cosmos DB for MongoDB vCore backend.
 * Source: https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/limits
 * (mirror: https://docs.azure.cn/en-us/documentdb/limitations, last verified Feb 2026).
 *
 * The MCP server refuses to start with values above these ceilings so admins discover
 * misconfiguration immediately rather than via opaque driver errors at request time.
 *
 * Values chosen below match documented backend behavior:
 *   - MAX_INSERT_BATCH_SIZE: 25,000 — "Maximum writes per batch operation: 25,000 writes."
 *   - MAX_RETURN_BYTES:      48 MB — MongoDB wire-protocol message ceiling (3 * 16 MB doc cap).
 *   - MAX_FIND_LIMIT / MAX_SAMPLE_SIZE: conservative caller-facing caps (memory-safe;
 *     real ceiling is the response-byte cap and per-tier query memory limit, e.g. ~150 MiB on M80).
 *   - MONGODB_MAX_TIME_MS: 600,000 (10 min) — well above the 120s default but below cursor lifetime.
 */
const BACKEND_HARD_LIMITS: Readonly<Record<string, number>> = {
    MAX_FIND_LIMIT: 10_000,
    MAX_SAMPLE_SIZE: 10_000,
    MAX_INSERT_BATCH_SIZE: 25_000,
    MAX_RETURN_BYTES: 48 * 1024 * 1024,
    MONGODB_MAX_TIME_MS: 600_000,
};

function parseBoundedPositiveInt(value: string | undefined, defaultValue: number, name: string): number {
    const parsed = parsePositiveInt(value, defaultValue, name);
    const ceiling = BACKEND_HARD_LIMITS[name];
    if (ceiling !== undefined && parsed > ceiling) {
        throw new Error(
            `${name}=${parsed} exceeds the Azure DocumentDB hard limit of ${ceiling}. ` +
                `Lower the value in your environment.`,
        );
    }
    return parsed;
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
        writeTools: parseBoolean(process.env.ENABLE_WRITE_TOOLS, false),
        managementTools: parseBoolean(process.env.ENABLE_MANAGEMENT_TOOLS, false),
        allowWriteStagesInAggregate: parseBoolean(process.env.ALLOW_AGGREGATE_WRITE_STAGES, false),
    },
    limits: {
        maxFindLimit: parseBoundedPositiveInt(process.env.MAX_FIND_LIMIT, 100, 'MAX_FIND_LIMIT'),
        maxSampleSize: parseBoundedPositiveInt(process.env.MAX_SAMPLE_SIZE, 50, 'MAX_SAMPLE_SIZE'),
        maxInsertBatchSize: parseBoundedPositiveInt(
            process.env.MAX_INSERT_BATCH_SIZE,
            100,
            'MAX_INSERT_BATCH_SIZE',
        ),
        maxReturnBytes: parseBoundedPositiveInt(process.env.MAX_RETURN_BYTES, 1_048_576, 'MAX_RETURN_BYTES'),
        mongoMaxTimeMs: parseBoundedPositiveInt(process.env.MONGODB_MAX_TIME_MS, 30_000, 'MONGODB_MAX_TIME_MS'),
    },
    connectionProfiles: parseConnectionProfiles(process.env.CONNECTION_PROFILES, process.env.CONNECTION_PROFILES_FILE),
    allowUnauthenticatedStdio: parseBoolean(process.env.ALLOW_UNAUTHENTICATED_STDIO, false),
};
