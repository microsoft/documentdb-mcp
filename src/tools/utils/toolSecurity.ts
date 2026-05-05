import { z } from 'zod';
import { type ToolRole } from '../../config';

export const connectionProfileSchema = z
    .string()
    .optional()
    .describe(
        'Administrator-defined connection profile name. Optional when the server has only one profile configured AND is running on stdio transport (e.g., the local quickstart). Otherwise required.',
    );

export interface SecureToolInput {
    connection_profile?: string;
}

export interface ToolSecurityPolicy {
    toolName: string;
    requiredRole: ToolRole;
}
