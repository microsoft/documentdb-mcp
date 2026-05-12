import { z } from 'zod';
import { type ToolRole } from '../../config';

export const connectionProfileSchema = z
    .string()
    .describe('Administrator-defined connection profile for this stateless tool call');

export interface SecureToolInput {
    connection_profile: string;
    db_name?: string;
    collection_name?: string;
    new_collection_name?: string;
    /**
     * Optional aggregation pipeline. Present on `aggregate` and on `explain_operation` when
     * `operation === 'aggregate'`. When set, `withDbGuard` runs `assertPipelineNamespacesAllowed`
     * against every namespace referenced from inside the pipeline before opening any backend
     * connection.
     */
    pipeline?: unknown;
    /**
     * For `explain_operation`, the pipeline check should only run when this is `'aggregate'`.
     * Other tools may leave this undefined.
     */
    operation?: string;
}

export interface ToolSecurityPolicy {
    toolName: string;
    requiredRole: ToolRole;
}
