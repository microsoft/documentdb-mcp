import { config, type ToolRole } from '../config';
import { getRequestContext } from './requestContext';

const roleRank: Record<ToolRole, number> = {
    read: 1,
    write: 2,
    management: 3,
};

function configuredValuesForRole(role: ToolRole): string[] {
    if (role === 'management') return config.authorization.managementRoleValues;
    if (role === 'write') return config.authorization.writeRoleValues;
    return config.authorization.readRoleValues;
}

function principalHasDirectRole(role: ToolRole): boolean {
    const principal = getRequestContext()?.principal;
    if (!principal) return false;
    const allowedValues = configuredValuesForRole(role);
    if (allowedValues.length === 0) return false;
    const claimValues = new Set([...principal.roles, ...principal.groups, ...principal.scopes]);
    return allowedValues.some((value) => claimValues.has(value));
}

export function getPrincipalEffectiveRole(): ToolRole | undefined {
    if (principalHasDirectRole('management')) return 'management';
    if (principalHasDirectRole('write')) return 'write';
    if (principalHasDirectRole('read')) return 'read';
    return undefined;
}

export function assertAuthorized(requiredRole: ToolRole): void {
    if (!config.auth.required || (config.transport === 'stdio' && config.trustLocalStdio)) {
        return;
    }
    const effectiveRole = getPrincipalEffectiveRole();
    if (!effectiveRole || roleRank[effectiveRole] < roleRank[requiredRole]) {
        throw new Error(`Caller is not authorized for '${requiredRole}' MCP tools.`);
    }
}

export function assertCapabilityEnabled(requiredRole: ToolRole): void {
    if (requiredRole === 'read' && !config.capabilities.readTools) {
        throw new Error('Read tools are disabled by server configuration.');
    }
    if (requiredRole === 'write' && !config.capabilities.writeTools) {
        throw new Error('Write tools are disabled by default. Set ENABLE_WRITE_TOOLS=true to opt in.');
    }
    if (requiredRole === 'management' && !config.capabilities.managementTools) {
        throw new Error('Management tools are disabled by default. Set ENABLE_MANAGEMENT_TOOLS=true to opt in.');
    }
}
