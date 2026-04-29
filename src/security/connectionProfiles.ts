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
