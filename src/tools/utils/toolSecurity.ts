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
}

export interface ToolSecurityPolicy {
    toolName: string;
    requiredRole: ToolRole;
}
