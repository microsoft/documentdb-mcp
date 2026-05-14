/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reject multi-document write/delete operations that target the entire collection (empty filter)
 * unless the caller explicitly opts in via `confirm_full_collection_operation: true`.
 *
 * Triggered when both:
 *   - `multi === true`, AND
 *   - the parsed filter is an empty object (`{}`)
 *
 * Single-document operations (`multi !== true`) are unaffected even with an empty filter, since
 * they touch at most one document.
 *
 * Throws an actionable error naming the tool and the required confirmation field.
 */
export function assertFullCollectionOpAllowed(
    toolName: 'update_documents' | 'delete_documents',
    parsedFilter: unknown,
    parsedMulti: unknown,
    confirmFlag: unknown,
): void {
    if (parsedMulti !== true) return;
    if (!isEmptyFilter(parsedFilter)) return;
    if (confirmFlag === true) return;

    throw new Error(
        `${toolName} with multi=true and an empty filter targets every document in the collection. ` +
            `Set confirm_full_collection_operation=true to proceed, or narrow the filter.`,
    );
}

function isEmptyFilter(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value as Record<string, unknown>).length === 0
    );
}
