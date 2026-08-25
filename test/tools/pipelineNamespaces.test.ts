import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadModule(connectionProfiles: string) {
    vi.resetModules();
    process.env = {
        ...originalEnv,
        CONNECTION_PROFILES: connectionProfiles,
    };
    return import('../../src/tools/utils/pipelineNamespaces');
}

describe('collectPipelineNamespaces', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('returns empty for non-array input', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        expect(collectPipelineNamespaces(undefined)).toEqual([]);
        expect(collectPipelineNamespaces('not a pipeline')).toEqual([]);
        expect(collectPipelineNamespaces({})).toEqual([]);
    });

    it('extracts $lookup.from string and nested pipeline namespaces', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        const refs = collectPipelineNamespaces([
            { $lookup: { from: 'maintenance', localField: 'id', foreignField: 'vid', as: 'm' } },
            {
                $lookup: {
                    from: 'audit',
                    pipeline: [{ $unionWith: 'leaks' }],
                    as: 'a',
                },
            },
        ]);
        expect(refs.map((r) => `${r.stage}:${r.collection}`)).toEqual([
            '$lookup:maintenance',
            '$lookup:audit',
            '$unionWith:leaks',
        ]);
    });

    it('extracts $lookup.from {db, coll} cross-database form', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        const refs = collectPipelineNamespaces([
            { $lookup: { from: { db: 'secrets', coll: 'passwords' }, as: 'x' } },
        ]);
        expect(refs).toEqual([{ db: 'secrets', collection: 'passwords', stage: '$lookup' }]);
    });

    it('extracts $unionWith string and object forms', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        const refs = collectPipelineNamespaces([
            { $unionWith: 'shorthand' },
            { $unionWith: { coll: 'with_pipeline', pipeline: [{ $lookup: { from: 'inner', as: 'i' } }] } },
        ]);
        expect(refs.map((r) => `${r.stage}:${r.collection}`)).toEqual([
            '$unionWith:shorthand',
            '$unionWith:with_pipeline',
            '$lookup:inner',
        ]);
    });

    it('extracts $graphLookup.from', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        const refs = collectPipelineNamespaces([
            { $graphLookup: { from: 'tree', startWith: '$id', connectFromField: 'parent', connectToField: '_id', as: 't' } },
        ]);
        expect(refs).toEqual([{ collection: 'tree', stage: '$graphLookup' }]);
    });

    it('extracts $merge.into and $out (string and {db, coll})', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        const refs = collectPipelineNamespaces([
            { $merge: { into: 'reports' } },
            { $merge: { into: { db: 'warehouse', coll: 'rollups' } } },
            { $out: 'snapshot' },
            { $out: { db: 'archive', coll: 'snap2' } },
        ]);
        expect(refs).toEqual([
            { collection: 'reports', stage: '$merge' },
            { db: 'warehouse', collection: 'rollups', stage: '$merge' },
            { collection: 'snapshot', stage: '$out' },
            { db: 'archive', collection: 'snap2', stage: '$out' },
        ]);
    });

    it('recursively walks $facet sub-pipelines', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        const refs = collectPipelineNamespaces([
            {
                $facet: {
                    groupA: [{ $lookup: { from: 'a', as: 'x' } }],
                    groupB: [{ $unionWith: 'b' }],
                },
            },
        ]);
        expect(refs.map((r) => `${r.stage}:${r.collection}`).sort()).toEqual([
            '$lookup:a',
            '$unionWith:b',
        ]);
    });

    it('ignores stages without recognized namespace fields', async () => {
        const { collectPipelineNamespaces } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');
        const refs = collectPipelineNamespaces([
            { $match: { status: 'active' } },
            { $group: { _id: '$kind', n: { $sum: 1 } } },
            { $project: { _id: 0, kind: 1 } },
            { $sort: { kind: 1 } },
        ]);
        expect(refs).toEqual([]);
    });
});

describe('assertPipelineNamespacesAllowed', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('passes when every referenced namespace is in scope', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule(
            '{"dev":{"authMode":"connectionString","uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles","maintenance"]}}}',
        );

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [
                { $lookup: { from: 'maintenance', as: 'm' } },
            ]),
        ).not.toThrow();
    });

    it('rejects $lookup.from when target collection is not allowed', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule(
            '{"dev":{"authMode":"connectionString","uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}',
        );

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [
                { $lookup: { from: 'audit_log', as: 'a' } },
            ]),
        ).toThrow(/Aggregation stage \$lookup references fleet\.audit_log:.*Collection 'fleet\.audit_log' is not allowed/);
    });

    it('rejects $lookup cross-database reference when target db is not allowed', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule(
            '{"dev":{"authMode":"connectionString","uri":"mongodb://fake","allowedDatabases":["fleet"]}}',
        );

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [
                { $lookup: { from: { db: 'secrets', coll: 'passwords' }, as: 'p' } },
            ]),
        ).toThrow(/Aggregation stage \$lookup references secrets\.passwords:.*Database 'secrets' is not allowed/);
    });

    it('rejects $unionWith targeting a denied collection', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule(
            '{"dev":{"authMode":"connectionString","uri":"mongodb://fake","deniedCollections":{"fleet":["audit_log"]}}}',
        );

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [{ $unionWith: 'audit_log' }]),
        ).toThrow(/Aggregation stage \$unionWith references fleet\.audit_log:.*Collection 'fleet\.audit_log' is denied/);
    });

    it('rejects $merge.into pointing to a denied database', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule(
            '{"dev":{"authMode":"connectionString","uri":"mongodb://fake","deniedDatabases":["warehouse"]}}',
        );

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [
                { $merge: { into: { db: 'warehouse', coll: 'rollups' } } },
            ]),
        ).toThrow(/Aggregation stage \$merge references warehouse\.rollups:.*Database 'warehouse' is denied/);
    });

    it('rejects $facet sub-pipeline that references a disallowed collection', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule(
            '{"dev":{"authMode":"connectionString","uri":"mongodb://fake","allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}',
        );

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [
                { $facet: { sub: [{ $lookup: { from: 'leaks', as: 'l' } }] } },
            ]),
        ).toThrow(/Aggregation stage \$lookup references fleet\.leaks:.*Collection 'fleet\.leaks' is not allowed/);
    });

    it('is a no-op for profile without any scope configuration', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake"}}');

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [
                { $lookup: { from: { db: 'anything', coll: 'goes' }, as: 'x' } },
                { $unionWith: 'whatever' },
            ]),
        ).not.toThrow();
    });

    it('rejects a blank db in $merge.into even when the profile has no scope (empty-string bypass)', async () => {
        // $merge into {db:"", coll} must not resolve to the connection default database and skip checks.
        const { assertPipelineNamespacesAllowed } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake/prod"}}');

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [
                { $merge: { into: { db: '', coll: 'rollups' } } },
            ]),
        ).toThrow(/Database name must not be empty/);
    });

    it('rejects a blank db in $out even when the profile has no scope (empty-string bypass)', async () => {
        const { assertPipelineNamespacesAllowed } = await loadModule('{"dev":{"authMode":"connectionString","uri":"mongodb://fake/prod"}}');

        expect(() =>
            assertPipelineNamespacesAllowed('dev', 'fleet', [{ $out: { db: '', coll: 'exfil' } }]),
        ).toThrow(/Database name must not be empty/);
    });
});
