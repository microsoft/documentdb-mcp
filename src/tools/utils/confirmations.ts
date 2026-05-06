/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Throw if `confirmation` does not exactly equal `expected`.
 *
 * Safety guard for irreversible destructive tools (drop_database, drop_collection, drop_index).
 * Requires the caller to retype the target resource name. Prevents accidental destruction.
 */
export function assertDestructiveConfirmation(
    fieldName: string,
    expected: string,
    confirmation: string | undefined,
): void {
    if (confirmation === undefined || confirmation === null || confirmation === '') {
        throw new Error(
            `${fieldName} is required for this destructive operation. Set ${fieldName}='${expected}' to confirm.`,
        );
    }
    if (confirmation !== expected) {
        throw new Error(
            `${fieldName} ('${confirmation}') does not match the target resource ('${expected}'). Operation rejected.`,
        );
    }
}
