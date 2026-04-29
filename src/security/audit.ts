import { type ToolRole } from '../config';
import { getRequestContext } from './requestContext';

export interface AuditEvent {
    toolName: string;
    requiredRole: ToolRole;
    decision: 'allow' | 'deny';
    reason?: string;
    connectionProfile?: string;
}

export function auditToolInvocation(event: AuditEvent): void {
    const context = getRequestContext();
    const principal = context?.principal;
    const auditRecord = {
        timestamp: new Date().toISOString(),
        toolName: event.toolName,
        requiredRole: event.requiredRole,
        decision: event.decision,
        reason: event.reason,
        connectionProfile: event.connectionProfile,
        transport: context?.transport,
        sessionId: context?.sessionId,
        requestId: context?.requestId,
        principal: principal
            ? {
                  oid: principal.oid,
                  sub: principal.sub,
                  tid: principal.tid,
                  upn: principal.upn,
                  name: principal.name,
              }
            : undefined,
    };
    console.error(`[MCP-AUDIT] ${JSON.stringify(auditRecord)}`);
}
