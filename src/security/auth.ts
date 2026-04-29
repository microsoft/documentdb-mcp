import { type NextFunction, type Request, type Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config';
import { type AuthenticatedPrincipal } from './requestContext';

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
    if (!jwks) {
        if (!config.auth.tenantId) {
            throw new Error('ENTRA_TENANT_ID is required when AUTH_REQUIRED=true.');
        }
        jwks = createRemoteJWKSet(
            new URL(`https://login.microsoftonline.com/${config.auth.tenantId}/discovery/v2.0/keys`),
        );
    }
    return jwks;
}

function toArrayClaim(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value === 'string') return value.split(' ').filter(Boolean);
    return [];
}

function principalFromClaims(payload: JWTPayload): AuthenticatedPrincipal {
    return {
        oid: typeof payload.oid === 'string' ? payload.oid : undefined,
        sub: typeof payload.sub === 'string' ? payload.sub : undefined,
        tid: typeof payload.tid === 'string' ? payload.tid : undefined,
        upn:
            typeof payload.preferred_username === 'string'
                ? payload.preferred_username
                : typeof payload.upn === 'string'
                  ? payload.upn
                  : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        roles: toArrayClaim(payload.roles),
        groups: toArrayClaim(payload.groups),
        scopes: toArrayClaim(payload.scp),
    };
}

function bearerTokenFromHeader(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
    return token;
}

export async function authenticateRequest(req: Request): Promise<AuthenticatedPrincipal> {
    if (!config.auth.required) {
        return {
            sub: 'auth-disabled',
            roles: ['auth-disabled'],
            groups: [],
            scopes: [],
        };
    }
    if (!config.auth.audience) {
        throw new Error('ENTRA_AUDIENCE or ENTRA_CLIENT_ID is required when AUTH_REQUIRED=true.');
    }

    const token = bearerTokenFromHeader(req.headers.authorization);
    if (!token) {
        throw new Error('Missing bearer token.');
    }

    const issuer = `https://login.microsoftonline.com/${config.auth.tenantId}/v2.0`;
    const { payload } = await jwtVerify(token, getJwks(), {
        issuer,
        audience: config.auth.audience,
    });
    return principalFromClaims(payload);
}

export function requireHttpAuthentication() {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            (req as Request & { principal?: AuthenticatedPrincipal }).principal = await authenticateRequest(req);
            next();
        } catch (error) {
            res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: error instanceof Error ? error.message : String(error),
                },
                id: null,
            });
        }
    };
}

export function getRequestPrincipal(req: Request): AuthenticatedPrincipal | undefined {
    return (req as Request & { principal?: AuthenticatedPrincipal }).principal;
}
