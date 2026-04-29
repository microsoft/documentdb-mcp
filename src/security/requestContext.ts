import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthenticatedPrincipal {
    oid?: string;
    sub?: string;
    tid?: string;
    upn?: string;
    name?: string;
    roles: string[];
    groups: string[];
    scopes: string[];
}

export interface RequestContext {
    principal?: AuthenticatedPrincipal;
    sessionId?: string;
    transport: 'stdio' | 'sse' | 'streamable-http';
    requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, handler: () => Promise<T> | T): Promise<T> | T {
    return storage.run(context, handler);
}

export function getRequestContext(): RequestContext | undefined {
    return storage.getStore();
}
