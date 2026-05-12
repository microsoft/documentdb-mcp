import { config, type ToolRole } from '../config';
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
 * Resource scope advertised by a connection profile.
 * Field semantics: undefined = unrestricted, [] = explicit deny-all (allow*), [...] = narrow to listed entries.
 * Denylists (denied*) are deny-wins overlays on top of the allowlist.
 */
export interface ProfileScope {
    allowedDatabases?: string[];
    allowedCollections?: Record<string, string[]>;
    deniedDatabases?: string[];
    deniedCollections?: Record<string, string[]>;
}

/**
 * Return the profile's allowlist + denylist scope (or empty scope if none configured).
 * Callers needing to filter list responses (e.g. list_databases) read this directly.
 */
export function getProfileScope(profileName: string): ProfileScope {
    const profile = config.connectionProfiles[profileName];
    if (!profile) return {};
    return {
        allowedDatabases: profile.allowedDatabases,
        allowedCollections: profile.allowedCollections,
        deniedDatabases: profile.deniedDatabases,
        deniedCollections: profile.deniedCollections,
    };
}

/**
 * Reject tool calls that target a database or collection not listed in the profile's allowlist,
 * or explicitly listed in the profile's denylist (deny wins).
 *
 * Allowlist rules (uniform with `allowedRoles`: omitted = default, listed = narrow, empty = explicit deny-all):
 *   - If `allowedDatabases` is undefined, all databases pass the allowlist gate.
 *   - If `allowedDatabases` is an empty array, **no databases pass** (explicit lock-to-nothing).
 *   - If `allowedDatabases` is set, `dbName` must be present in the list (case-sensitive).
 *   - If `allowedCollections[dbName]` is undefined, all collections in that db pass the allowlist gate.
 *   - If `allowedCollections[dbName]` is an empty array, **no collections in that db pass**.
 *   - If `allowedCollections[dbName]` is set, `collectionName` must be present in that list.
 *
 * Denylist rules (deny wins; checked before the allowlist so denials always win):
 *   - If `deniedDatabases` includes `dbName`, the call is denied even if the allowlist would permit it.
 *   - If `deniedCollections[dbName]` includes `collectionName`, the call is denied.
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
    const { allowedDatabases, allowedCollections, deniedDatabases, deniedCollections } = profile;

    // Denylists run first — deny wins.
    if (dbName && deniedDatabases && deniedDatabases.includes(dbName)) {
        throw new Error(
            `Database '${dbName}' is denied for connection profile '${profileName}'.`,
        );
    }
    if (dbName && collectionName && deniedCollections) {
        const deniedPerDb = deniedCollections[dbName];
        if (deniedPerDb && deniedPerDb.includes(collectionName)) {
            throw new Error(
                `Collection '${dbName}.${collectionName}' is denied for connection profile '${profileName}'.`,
            );
        }
    }

    if (dbName && allowedDatabases !== undefined) {
        if (!allowedDatabases.includes(dbName)) {
            const allowedList = allowedDatabases.length > 0 ? allowedDatabases.join(', ') : '(none)';
            throw new Error(
                `Database '${dbName}' is not allowed for connection profile '${profileName}'. ` +
                    `Allowed databases: ${allowedList}.`,
            );
        }
    }

    if (dbName && collectionName && allowedCollections) {
        const perDb = allowedCollections[dbName];
        if (perDb !== undefined && !perDb.includes(collectionName)) {
            const allowedList = perDb.length > 0 ? perDb.join(', ') : '(none)';
            throw new Error(
                `Collection '${dbName}.${collectionName}' is not allowed for connection profile '${profileName}'. ` +
                    `Allowed collections in '${dbName}': ${allowedList}.`,
            );
        }
    }
}

/**
 * Reject tool calls whose required capability tier is not permitted by the profile.
 *
 * Uniform `allowedRoles` semantics (mirrors `allowedDatabases` / `allowedCollections`):
 *   - omitted (`undefined`) → documented default `["read"]` (read-only)
 *   - empty (`[]`)         → **explicit deny-all** (no tiers, not even read)
 *   - listed (`[...]`)     → exactly those tiers
 *
 * Runs after the global `assertCapabilityEnabled` and `assertAuthorized` checks. This narrows what a profile permits;
 * it never broadens the global capability flags or the caller's role.
 */
export function assertProfileCapabilityAllowed(profileName: string, requiredRole: ToolRole): void {
    const profile = config.connectionProfiles[profileName];
    if (!profile) {
        // resolveConnectionProfile will surface the unknown-profile error; nothing to enforce here.
        return;
    }

    const { allowedRoles, readOnly } = profile;
    const baseRoles: ToolRole[] = allowedRoles === undefined ? ['read'] : allowedRoles;
    // readOnly=true forces the effective set to the intersection with ['read'].
    // It can never broaden what allowedRoles permits.
    const effectiveRoles: ToolRole[] = readOnly === true ? baseRoles.filter((r) => r === 'read') : baseRoles;

    if (!effectiveRoles.includes(requiredRole)) {
        const allowedList = effectiveRoles.length > 0 ? effectiveRoles.join(', ') : '(none)';
        const readOnlySuffix = readOnly === true && requiredRole !== 'read' ? " Profile is configured as readOnly." : '';
        throw new Error(
            `Tool tier '${requiredRole}' is not allowed for connection profile '${profileName}'. ` +
                `Allowed tiers: ${allowedList}.${readOnlySuffix}`,
        );
    }
}
