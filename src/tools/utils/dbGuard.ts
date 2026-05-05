import { type MongoClient } from 'mongodb';
import { config } from '../../config';
import { withDocumentDBClient } from '../../context/documentdb';
import { auditToolInvocation } from '../../security/audit';
import { assertAuthorized, assertCapabilityEnabled } from '../../security/authorization';
import { resolveConnectionProfile } from '../../security/connectionProfiles';
import { type SecureToolInput, type ToolSecurityPolicy } from './toolSecurity';

function resolveEffectiveProfileName(requested: string | undefined): string {
    if (requested) return requested;
    const names = Object.keys(config.connectionProfiles);
    if (names.length === 0) {
        throw new Error('No connection profile is configured on this server.');
    }
    if (config.transport !== 'stdio') {
        throw new Error('connection_profile is required for stateless DocumentDB tool execution.');
    }
    if (names.length > 1) {
        throw new Error('connection_profile is required when more than one profile is configured.');
    }
    return names[0];
}

export function withDbGuard<Inp extends SecureToolInput>(
    policy: ToolSecurityPolicy,
    handler: (input: Inp, client: MongoClient) => Promise<any> | any,
) {
    return async (input: Inp, _extra?: unknown): Promise<any> => {
        let authorized = false;
        let effectiveProfile: string | undefined;
        try {
            assertCapabilityEnabled(policy.requiredRole);
            assertAuthorized(policy.requiredRole);
            authorized = true;
            effectiveProfile = resolveEffectiveProfileName(input.connection_profile);
            const connection = resolveConnectionProfile(effectiveProfile);
            auditToolInvocation({
                toolName: policy.toolName,
                requiredRole: policy.requiredRole,
                decision: 'allow',
                connectionProfile: effectiveProfile,
            });
            const effectiveInput = { ...input, connection_profile: effectiveProfile } as Inp;
            return await withDocumentDBClient<any>(connection, (client) => handler(effectiveInput, client));
        } catch (error) {
            auditToolInvocation({
                toolName: policy.toolName,
                requiredRole: policy.requiredRole,
                decision: 'deny',
                reason: error instanceof Error ? error.message : String(error),
                connectionProfile: authorized ? effectiveProfile : input.connection_profile,
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { error: error instanceof Error ? error.message : String(error) },
                            null,
                            2,
                        ),
                    },
                ],
                isError: true,
            };
        }
    };
}
