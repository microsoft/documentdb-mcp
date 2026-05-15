/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConnectionProfileConfig, MCPConfig, ToolRole } from '../config';

const VALID_TRANSPORTS = ['stdio', 'sse', 'streamable-http'] as const;
const VALID_ROLES: ToolRole[] = ['read', 'write', 'management'];

/**
 * Run all startup configuration checks against an already-parsed `MCPConfig`. Throws an
 * aggregated `Error` listing every problem found so a misconfigured operator sees the full
 * picture in one go rather than playing whack-a-mole one variable at a time.
 *
 * Called from `main.ts` immediately after `config` is loaded, before any transport, server,
 * or tool registration runs. Pure function: no I/O beyond reading `process.env` for `uriEnv`
 * resolution checks.
 */
export function validateConfig(config: MCPConfig): void {
    const errors: string[] = [];

    validateTransport(config, errors);
    validatePort(config, errors);
    validateRateLimit(config, errors);
    validateAuth(config, errors);
    validateProfiles(config, errors);

    if (errors.length > 0) {
        throw new Error(
            `Invalid configuration; refusing to start. Found ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`,
        );
    }
}

function validateTransport(config: MCPConfig, errors: string[]): void {
    if (!VALID_TRANSPORTS.includes(config.transport as (typeof VALID_TRANSPORTS)[number])) {
        errors.push(
            `TRANSPORT='${config.transport}' is invalid. Must be one of: ${VALID_TRANSPORTS.join(', ')}.`,
        );
    }
}

function validatePort(config: MCPConfig, errors: string[]): void {
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
        errors.push(`PORT=${config.port} is invalid. Must be an integer in [1, 65535].`);
    }
}

function validateRateLimit(config: MCPConfig, errors: string[]): void {
    const { windowMs, maxRequests } = config.rateLimit;
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
        errors.push(`RATE_LIMIT_WINDOW_MS=${windowMs} must be a positive integer.`);
    }
    if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
        errors.push(`RATE_LIMIT_MAX_REQUESTS=${maxRequests} must be a positive integer.`);
    }
}

function validateAuth(config: MCPConfig, errors: string[]): void {
    if (!config.auth.required) return;
    if (!config.auth.tenantId) {
        errors.push('AUTH_REQUIRED=true requires ENTRA_TENANT_ID to be set.');
    }
    if (!config.auth.audience) {
        errors.push('AUTH_REQUIRED=true requires ENTRA_AUDIENCE (or ENTRA_CLIENT_ID) to be set.');
    }
}

function validateProfiles(config: MCPConfig, errors: string[]): void {
    for (const [name, profile] of Object.entries(config.connectionProfiles)) {
        validateProfile(name, profile, errors);
    }
}

function validateProfile(name: string, profile: ConnectionProfileConfig, errors: string[]): void {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        errors.push(`Connection profile '${name}' must be a JSON object.`);
        return;
    }

    const authModeIsInvalid =
        profile.authMode !== undefined &&
        profile.authMode !== 'entra' &&
        profile.authMode !== 'connectionString';
    if (authModeIsInvalid) {
        errors.push(
            `Connection profile '${name}' has invalid authMode='${profile.authMode}'. ` +
                `Must be 'entra' or 'connectionString'.`,
        );
    }

    // Only run auth-source checks (entra requirements vs connectionString uri/uriEnv) when
    // authMode is recognized. With an invalid authMode the operator already has one clear,
    // actionable error; piling on a second message that suggests `authMode=entra` as a fix
    // would contradict the first. Allowlist shape checks below are orthogonal and still run.
    if (!authModeIsInvalid) {
        if (profile.authMode === 'entra') {
            if (!profile.endpoint && !profile.uri) {
                errors.push(
                    `Connection profile '${name}' uses Entra authentication and must define endpoint (or uri).`,
                );
            }
            if (!profile.tokenScope && !profile.tokenResource) {
                errors.push(
                    `Connection profile '${name}' uses Entra authentication and must define tokenScope or tokenResource.`,
                );
            }
        } else {
            // Either explicit 'connectionString' or unspecified: must yield a usable URI source.
            if (!profile.uri && !profile.uriEnv) {
                errors.push(
                    `Connection profile '${name}' must define authMode=entra, uri, or uriEnv.`,
                );
            }
            if (profile.uriEnv && !process.env[profile.uriEnv]) {
                errors.push(
                    `Connection profile '${name}' references environment variable '${profile.uriEnv}', which is not set.`,
                );
            }
        }
    }

    validateStringArray(name, 'allowedDatabases', profile.allowedDatabases, errors);
    validateStringArray(name, 'deniedDatabases', profile.deniedDatabases, errors);
    validateStringArray(name, 'allowedHosts', profile.allowedHosts, errors);
    validateRecordOfStringArrays(name, 'allowedCollections', profile.allowedCollections, errors);
    validateRecordOfStringArrays(name, 'deniedCollections', profile.deniedCollections, errors);
    validateAllowedRoles(name, profile.allowedRoles, errors);
}

function validateStringArray(
    profileName: string,
    fieldName: string,
    value: unknown,
    errors: string[],
): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
        errors.push(
            `Connection profile '${profileName}' ${fieldName} must be a string array.`,
        );
        return;
    }
    for (const [i, item] of value.entries()) {
        if (typeof item !== 'string') {
            errors.push(
                `Connection profile '${profileName}' ${fieldName}[${i}] must be a string (got ${typeof item}).`,
            );
        }
    }
}

function validateRecordOfStringArrays(
    profileName: string,
    fieldName: string,
    value: unknown,
    errors: string[],
): void {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(
            `Connection profile '${profileName}' ${fieldName} must be an object mapping db -> string[].`,
        );
        return;
    }
    for (const [db, list] of Object.entries(value as Record<string, unknown>)) {
        if (!Array.isArray(list)) {
            errors.push(
                `Connection profile '${profileName}' ${fieldName}['${db}'] must be a string array.`,
            );
            continue;
        }
        for (const [i, item] of list.entries()) {
            if (typeof item !== 'string') {
                errors.push(
                    `Connection profile '${profileName}' ${fieldName}['${db}'][${i}] must be a string (got ${typeof item}).`,
                );
            }
        }
    }
}

function validateAllowedRoles(profileName: string, value: unknown, errors: string[]): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
        errors.push(`Connection profile '${profileName}' allowedRoles must be a string array.`);
        return;
    }
    for (const [i, item] of value.entries()) {
        if (typeof item !== 'string' || !VALID_ROLES.includes(item as ToolRole)) {
            errors.push(
                `Connection profile '${profileName}' allowedRoles[${i}]='${String(item)}' is invalid. ` +
                    `Allowed values: ${VALID_ROLES.join(', ')}.`,
            );
        }
    }
}
