import { type MongoClient } from 'mongodb';
import { withDocumentDBClient } from '../../context/documentdb';
import { auditToolInvocation } from '../../security/audit';
import { assertAuthorized, assertCapabilityEnabled } from '../../security/authorization';
import { assertResourceAllowed, resolveConnectionProfile } from '../../security/connectionProfiles';
import { type SecureToolInput, type ToolSecurityPolicy } from './toolSecurity';

export function withDbGuard<Inp extends SecureToolInput>(
    policy: ToolSecurityPolicy,
    handler: (input: Inp, client: MongoClient) => Promise<any> | any,
) {
    return async (input: Inp, _extra?: unknown): Promise<any> => {
        let authorized = false;
        if (!input.connection_profile) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { error: 'connection_profile is required for stateless DocumentDB tool execution.' },
                            null,
                            2,
                        ),
                    },
                ],
                isError: true,
            };
        }

        try {
            assertCapabilityEnabled(policy.requiredRole);
            assertAuthorized(policy.requiredRole);
            const connection = resolveConnectionProfile(input.connection_profile);
            // Enforce per-profile database/collection allowlists for both the source resource
            // and (when present) the rename target. Profiles with no allowlist pass through unchanged.
            assertResourceAllowed(input.connection_profile, {
                dbName: input.db_name,
                collectionName: input.collection_name,
            });
            if (input.new_collection_name) {
                assertResourceAllowed(input.connection_profile, {
                    dbName: input.db_name,
                    collectionName: input.new_collection_name,
                });
            }
            authorized = true;
            auditToolInvocation({
                toolName: policy.toolName,
                requiredRole: policy.requiredRole,
                decision: 'allow',
                connectionProfile: input.connection_profile,
            });
            return await withDocumentDBClient<any>(connection, (client) => handler(input, client));
        } catch (error) {
            if (!authorized) {
                auditToolInvocation({
                    toolName: policy.toolName,
                    requiredRole: policy.requiredRole,
                    decision: 'deny',
                    reason: error instanceof Error ? error.message : String(error),
                    connectionProfile: input.connection_profile,
                });
            }
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
