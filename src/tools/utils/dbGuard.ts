import { type MongoClient } from 'mongodb';
import { config } from '../../config';
import { withDocumentDBClient } from '../../context/documentdb';
import { auditToolInvocation } from '../../security/audit';
import { assertAuthorized, assertCapabilityEnabled } from '../../security/authorization';
import {
    assertProfileCapabilityAllowed,
    assertResourceAllowed,
    resolveConnectionProfile,
} from '../../security/connectionProfiles';
import { assertStdioRateLimit } from '../../security/rateLimit';
import { getRequestContext, runWithRequestContext } from '../../security/requestContext';
import { assertFullCollectionOpAllowed } from './fullCollectionGuard';
import { assertPipelineNamespacesAllowed } from './pipelineNamespaces';
import { type SecureToolInput, type ToolSecurityPolicy } from './toolSecurity';

function resolveEffectiveConnectionProfile(inputProfile: string | undefined): string {
    if (inputProfile && inputProfile.trim().length > 0) return inputProfile;

    if (config.transport === 'stdio') {
        if (config.defaultConnectionProfile) return config.defaultConnectionProfile;

        const profileNames = Object.keys(config.connectionProfiles);
        if (profileNames.length === 1) return profileNames[0];
    }

    throw new Error(
        'connection_profile is required for stateless DocumentDB tool execution. ' +
            'For local stdio usage, configure DEFAULT_CONNECTION_PROFILE to allow tools to omit it.',
    );
}

function normalizePipeline(raw: unknown): unknown {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim().length > 0) {
        try {
            return JSON.parse(raw);
        } catch {
            // Defer to the in-handler parser to surface a clear parse error; namespace walker no-ops.
            return undefined;
        }
    }
    return undefined;
}

function normalizeFilter(raw: unknown): unknown {
    if (raw === undefined) return undefined;
    if (typeof raw === 'string') {
        if (raw.trim().length === 0) return undefined;
        try {
            return JSON.parse(raw);
        } catch {
            // Defer to the in-handler parser to surface a clear parse error; full-collection guard no-ops.
            return undefined;
        }
    }
    return raw;
}

function normalizeBoolean(raw: unknown): unknown {
    if (typeof raw === 'string') {
        if (raw === 'true') return true;
        if (raw === 'false') return false;
    }
    return raw;
}

export function withDbGuard<Inp extends SecureToolInput>(
    policy: ToolSecurityPolicy,
    handler: (input: Inp, client: MongoClient) => Promise<any> | any,
) {
    const guarded = async (input: Inp, _extra?: unknown): Promise<any> => {
        let authorized = false;
        let connectionProfile: string;
        try {
            assertStdioRateLimit();
            connectionProfile = resolveEffectiveConnectionProfile(input.connection_profile);
            input.connection_profile = connectionProfile;
        } catch (error) {
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

        try {
            assertCapabilityEnabled(policy.requiredRole);
            assertAuthorized(policy.requiredRole);
            const connection = resolveConnectionProfile(connectionProfile);
            // Enforce per-profile capability tier (allowedRoles).
            // Profiles with no role/capability config pass through unchanged.
            assertProfileCapabilityAllowed(connectionProfile, policy.requiredRole);
            // Enforce per-profile database/collection allow+deny lists for the source resource
            // and (when present) the rename target. Profiles with no scope pass through unchanged.
            assertResourceAllowed(connectionProfile, {
                dbName: input.db_name,
                collectionName: input.collection_name,
            });
            if (input.new_collection_name) {
                assertResourceAllowed(connectionProfile, {
                    dbName: input.db_name,
                    collectionName: input.new_collection_name,
                });
            }
            // Enforce per-profile resource scope on every namespace referenced from inside an
            // aggregation pipeline. Runs before the backend connection is opened so denies fail fast.
            // Skipped when input.pipeline is missing or (for explain_operation) when operation !== 'aggregate'.
            const pipelineApplies =
                input.pipeline !== undefined && (input.operation === undefined || input.operation === 'aggregate');
            if (pipelineApplies && input.db_name) {
                const normalized = normalizePipeline(input.pipeline);
                if (normalized !== undefined) {
                    assertPipelineNamespacesAllowed(connectionProfile, input.db_name, normalized);
                }
            }
            // Reject full-collection writes/deletes (multi=true + empty filter) unless the caller
            // opted in via confirm_full_collection_operation=true. Runs pre-connection so denies fail
            // fast. Only applies to update_documents and delete_documents.
            if (policy.toolName === 'update_documents' || policy.toolName === 'delete_documents') {
                const normalizedFilter = normalizeFilter(input.filter);
                const normalizedMulti = normalizeBoolean(input.multi);
                const normalizedConfirm = normalizeBoolean(input.confirm_full_collection_operation);
                if (normalizedFilter !== undefined) {
                    assertFullCollectionOpAllowed(
                        policy.toolName,
                        normalizedFilter,
                        normalizedMulti,
                        normalizedConfirm,
                    );
                }
            }
            authorized = true;
            auditToolInvocation({
                toolName: policy.toolName,
                requiredRole: policy.requiredRole,
                decision: 'allow',
                connectionProfile,
            });
            return await withDocumentDBClient<any>(connection, (client) => handler(input, client));
        } catch (error) {
            if (!authorized) {
                auditToolInvocation({
                    toolName: policy.toolName,
                    requiredRole: policy.requiredRole,
                    decision: 'deny',
                    reason: error instanceof Error ? error.message : String(error),
                    connectionProfile,
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

    return async (input: Inp, extra?: unknown): Promise<any> => {
        if (config.transport === 'stdio' && !getRequestContext()) {
            return runWithRequestContext({ transport: 'stdio' }, () => guarded(input, extra));
        }
        return guarded(input, extra);
    };
}
