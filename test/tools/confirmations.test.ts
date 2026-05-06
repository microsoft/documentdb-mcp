import { describe, expect, it } from 'vitest';
import { assertDestructiveConfirmation } from '../../src/tools/utils/confirmations';

describe('assertConfirmationMatches', () => {
    it('passes when confirmation exactly equals expected', () => {
        expect(() => assertDestructiveConfirmation('confirm_db_name', 'fleet', 'fleet')).not.toThrow();
    });

    it('throws when confirmation is undefined', () => {
        expect(() => assertDestructiveConfirmation('confirm_db_name', 'fleet', undefined)).toThrow(
            /confirm_db_name is required/,
        );
    });

    it('throws when confirmation is an empty string', () => {
        expect(() => assertDestructiveConfirmation('confirm_db_name', 'fleet', '')).toThrow(
            /confirm_db_name is required/,
        );
    });

    it('throws when confirmation does not match the expected value', () => {
        expect(() => assertDestructiveConfirmation('confirm_db_name', 'fleet', 'Fleet')).toThrow(
            /does not match the target resource/,
        );
        expect(() => assertDestructiveConfirmation('confirm_db_name', 'fleet', 'wrong')).toThrow(
            /does not match the target resource/,
        );
    });

    it('is case-sensitive and whitespace-sensitive', () => {
        expect(() => assertDestructiveConfirmation('confirm_collection_name', 'vehicles', 'Vehicles')).toThrow();
        expect(() => assertDestructiveConfirmation('confirm_collection_name', 'vehicles', 'vehicles ')).toThrow();
    });

    it('uses the provided field name in error messages', () => {
        expect(() => assertDestructiveConfirmation('confirm_index_name', 'idx_1', undefined)).toThrow(
            /confirm_index_name is required for this destructive operation/,
        );
        expect(() => assertDestructiveConfirmation('confirm_index_name', 'idx_1', 'wrong')).toThrow(
            /confirm_index_name \('wrong'\)/,
        );
    });
});
