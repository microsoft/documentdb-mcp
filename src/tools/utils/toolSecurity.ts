import { z } from 'zod';
import { type ToolRole } from '../../config';

export const connectionProfileSchema = z
    .string()
    .describe('Administrator-defined connection profile for this stateless tool call');

export interface SecureToolInput {
    connection_profile: string;
}

export interface ToolSecurityPolicy {
    toolName: string;
    requiredRole: ToolRole;
}
