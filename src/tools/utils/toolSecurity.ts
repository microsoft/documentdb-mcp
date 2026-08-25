import { z } from 'zod';
import { type ToolRole } from '../../config';

export const connectionProfileSchema = z
    .string()
    .optional()
    .describe('Administrator-defined connection profile for this stateless tool call');

// Reject empty/blank names at the input boundary; withDbGuard enforces the same before connecting.
export const dbNameSchema = z.string().min(1).describe('Name of the database');
export const collectionNameSchema = z.string().min(1).describe('Name of the collection');

export interface SecureToolInput {
    connection_profile?: string;
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
    /**
     * Filter for `update_documents` / `delete_documents`. When the tool is one of those two and
     * `multi === true`, `withDbGuard` runs `assertFullCollectionOpAllowed` before opening the
     * backend connection. Other tools leave this undefined.
     */
    filter?: unknown;
    /** Multi flag for `update_documents` / `delete_documents`. */
    multi?: unknown;
    /** Explicit opt-in to a full-collection (multi=true + empty filter) write or delete. */
    confirm_full_collection_operation?: unknown;
}

export interface ToolSecurityPolicy {
    toolName: string;
    requiredRole: ToolRole;
}
