import { config } from '../config';
import { type DocumentDBConnectionConfig } from '../context/documentdb';

function endpointToMongoUri(endpoint: string, tls: boolean | undefined): string {
    if (endpoint.startsWith('mongodb://') || endpoint.startsWith('mongodb+srv://')) return endpoint;
    const params = new URLSearchParams();
    if (tls !== false) params.set('tls', 'true');
    const query = params.toString();
    return `mongodb+srv://${endpoint}/${query ? `?${query}` : ''}`;
}

function normalizedTokenScope(profileName: string, tokenResource: string | undefined, tokenScope: string | undefined): string {
    const configuredScope = tokenScope || tokenResource;
    if (!configuredScope) {
        throw new Error(
            `Connection profile '${profileName}' uses Entra authentication and must define tokenScope or tokenResource.`,
        );
    }
    if (configuredScope.endsWith('/.default')) return configuredScope;
    return `${configuredScope.replace(/\/$/, '')}/.default`;
}

export function resolveConnectionProfile(profileName: string): DocumentDBConnectionConfig {
    const profile = config.connectionProfiles[profileName];
    if (!profile) {
        throw new Error(
            `Unknown connection profile '${profileName}'. Ask the MCP server administrator to configure it.`,
        );
    }

    if (profile.authMode === 'entra') {
        if (!profile.endpoint && !profile.uri) {
            throw new Error(`Connection profile '${profileName}' uses Entra authentication and must define endpoint or uri.`);
        }
        return {
            kind: 'entra',
            uri: endpointToMongoUri(profile.uri || profile.endpoint || '', profile.tls),
            tokenScope: normalizedTokenScope(profileName, profile.tokenResource, profile.tokenScope),
            tokenResource: profile.tokenResource,
            username: profile.username,
            retryWrites: profile.retryWrites,
            appName: profile.appName,
            allowedHosts: profile.allowedHosts,
        };
    }

    if (profile.uriEnv) {
        const uri = process.env[profile.uriEnv];
        if (!uri) {
            throw new Error(
                `Connection profile '${profileName}' references unset environment variable '${profile.uriEnv}'.`,
            );
        }
        return { kind: 'connectionString', uri };
    }

    if (profile.uri) {
        return { kind: 'connectionString', uri: profile.uri };
    }

    throw new Error(`Connection profile '${profileName}' must define authMode=entra, uriEnv, or uri.`);
}

/**
 * Resource scope advertised by a connection profile. Empty arrays / undefined fields mean "no restriction".
 */
export interface ProfileScope {
    allowedDatabases?: string[];
    allowedCollections?: Record<string, string[]>;
}

/**
 * Return the profile's allowlist scope (or empty scope if none configured).
 * Callers needing to filter list responses (e.g. list_databases) read this directly.
 */
export function getProfileScope(profileName: string): ProfileScope {
    const profile = config.connectionProfiles[profileName];
    if (!profile) return {};
    return {
        allowedDatabases: profile.allowedDatabases,
        allowedCollections: profile.allowedCollections,
    };
}

/**
 * Reject tool calls that target a database or collection not listed in the profile's allowlist.
 *
 * Rules:
 *   - If `allowedDatabases` is undefined or empty, all databases pass.
 *   - If `allowedDatabases` is set, `dbName` must be present in the list (case-sensitive).
 *   - If `allowedCollections[dbName]` is undefined, all collections in that db pass.
 *   - If `allowedCollections[dbName]` is set, `collectionName` must be present in that list.
 *
 * Fails closed with an actionable error so callers get a clear message instead of a backend permission error.
 */
export function assertResourceAllowed(
    profileName: string,
    target: { dbName?: string; collectionName?: string },
): void {
    const profile = config.connectionProfiles[profileName];
    if (!profile) {
        // resolveConnectionProfile will surface the unknown-profile error; nothing to enforce here.
        return;
    }

    const { dbName, collectionName } = target;
    const { allowedDatabases, allowedCollections } = profile;

    if (dbName && allowedDatabases && allowedDatabases.length > 0) {
        if (!allowedDatabases.includes(dbName)) {
            throw new Error(
                `Database '${dbName}' is not allowed for connection profile '${profileName}'. ` +
                    `Allowed databases: ${allowedDatabases.join(', ')}.`,
            );
        }
    }

    if (dbName && collectionName && allowedCollections) {
        const perDb = allowedCollections[dbName];
        if (perDb && perDb.length > 0 && !perDb.includes(collectionName)) {
            throw new Error(
                `Collection '${dbName}.${collectionName}' is not allowed for connection profile '${profileName}'. ` +
                    `Allowed collections in '${dbName}': ${perDb.join(', ')}.`,
            );
        }
    }
}
