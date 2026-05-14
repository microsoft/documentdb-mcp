/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { assertFullCollectionOpAllowed } from '../../src/tools/utils/fullCollectionGuard';

describe('assertFullCollectionOpAllowed', () => {
    it('rejects update_documents with multi=true and empty filter when confirm flag is missing', () => {
        expect(() => assertFullCollectionOpAllowed('update_documents', {}, true, false)).toThrow(
            /update_documents with multi=true and an empty filter.*confirm_full_collection_operation=true/,
        );
    });

    it('rejects delete_documents with multi=true and empty filter when confirm flag is missing', () => {
        expect(() => assertFullCollectionOpAllowed('delete_documents', {}, true, false)).toThrow(
            /delete_documents with multi=true and an empty filter.*confirm_full_collection_operation=true/,
        );
    });

    it('allows multi=true with empty filter when confirm_full_collection_operation=true', () => {
        expect(() => assertFullCollectionOpAllowed('delete_documents', {}, true, true)).not.toThrow();
    });

    it('allows multi=true with non-empty filter regardless of confirm flag', () => {
        expect(() => assertFullCollectionOpAllowed('update_documents', { status: 'active' }, true, false)).not.toThrow();
    });

    it('allows multi=false with empty filter regardless of confirm flag (single-doc op)', () => {
        expect(() => assertFullCollectionOpAllowed('delete_documents', {}, false, false)).not.toThrow();
    });

    it('treats confirm flag values other than true (false / undefined / "true" string) as not-confirmed', () => {
        expect(() => assertFullCollectionOpAllowed('delete_documents', {}, true, undefined)).toThrow();
        expect(() => assertFullCollectionOpAllowed('delete_documents', {}, true, 'true')).toThrow();
        expect(() => assertFullCollectionOpAllowed('delete_documents', {}, true, 1)).toThrow();
    });

    it('does not treat arrays as empty filter (defensive)', () => {
        expect(() => assertFullCollectionOpAllowed('delete_documents', [], true, false)).not.toThrow();
    });
});
