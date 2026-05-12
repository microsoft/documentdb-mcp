/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertResourceAllowed } from '../../security/connectionProfiles';

/**
 * Namespace referenced from inside an aggregation pipeline.
 * `db` is undefined for stage forms that omit it (e.g. `$lookup.from: "coll"`); the caller
 * resolves it against the current `db_name`.
 */
export interface PipelineNamespace {
    db?: string;
    collection: string;
    /** Stage operator that produced this reference (for error context). */
    stage: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pushNs(out: PipelineNamespace[], stage: string, value: unknown): void {
    if (typeof value === 'string' && value.length > 0) {
        out.push({ collection: value, stage });
        return;
    }
    if (isPlainObject(value)) {
        const db = typeof value.db === 'string' ? value.db : undefined;
        const coll = typeof value.coll === 'string' ? value.coll : undefined;
        if (coll) {
            out.push({ db, collection: coll, stage });
        }
    }
}

/**
 * Recursively collect every collection namespace referenced by an aggregation pipeline.
 *
 * Recognized stages:
 *   - `$lookup`        → `from` (string or `{db, coll}`); plus nested `pipeline` (recursive)
 *   - `$unionWith`     → string shorthand or `{coll, pipeline}` (recursive)
 *   - `$graphLookup`   → `from` (string only — does not support cross-db form)
 *   - `$merge`         → `into` (string or `{db, coll}`)
 *   - `$out`           → string or `{db, coll}`
 *   - `$facet`         → each value is a sub-pipeline (recursive)
 *
 * Unknown stages are ignored — the walker is conservative, not a validator. The pipeline itself is
 * still subject to the existing `assertAggregatePipelineIsReadOnly` gate, and the backend will
 * reject malformed stages.
 */
export function collectPipelineNamespaces(pipeline: unknown): PipelineNamespace[] {
    const out: PipelineNamespace[] = [];
    if (!Array.isArray(pipeline)) return out;

    for (const stage of pipeline) {
        if (!isPlainObject(stage)) continue;
        for (const [op, body] of Object.entries(stage)) {
            switch (op) {
                case '$lookup': {
                    if (isPlainObject(body)) {
                        pushNs(out, op, body.from);
                        if (Array.isArray(body.pipeline)) {
                            out.push(...collectPipelineNamespaces(body.pipeline));
                        }
                    }
                    break;
                }
                case '$unionWith': {
                    if (typeof body === 'string') {
                        pushNs(out, op, body);
                    } else if (isPlainObject(body)) {
                        if (typeof body.coll === 'string') {
                            out.push({ collection: body.coll, stage: op });
                        }
                        if (Array.isArray(body.pipeline)) {
                            out.push(...collectPipelineNamespaces(body.pipeline));
                        }
                    }
                    break;
                }
                case '$graphLookup': {
                    if (isPlainObject(body) && typeof body.from === 'string') {
                        out.push({ collection: body.from, stage: op });
                    }
                    break;
                }
                case '$merge': {
                    if (isPlainObject(body)) {
                        pushNs(out, op, body.into);
                    } else if (typeof body === 'string') {
                        pushNs(out, op, body);
                    }
                    break;
                }
                case '$out': {
                    pushNs(out, op, body);
                    break;
                }
                case '$facet': {
                    if (isPlainObject(body)) {
                        for (const subPipeline of Object.values(body)) {
                            out.push(...collectPipelineNamespaces(subPipeline));
                        }
                    }
                    break;
                }
                default:
                    // Unknown stage operator — not walked. Backend will validate the stage shape.
                    break;
            }
        }
    }

    return out;
}

/**
 * Apply the per-profile resource allowlist + denylist to every namespace referenced from inside an
 * aggregation pipeline. Throws on the first violation with an actionable message that names both the
 * referenced namespace and the originating stage operator.
 *
 * `currentDbName` is used as the default database for stage forms that reference only a collection
 * name (e.g. `$lookup.from: "vehicles"`).
 */
export function assertPipelineNamespacesAllowed(
    profileName: string,
    currentDbName: string,
    pipeline: unknown,
): void {
    const refs = collectPipelineNamespaces(pipeline);
    for (const ref of refs) {
        const dbName = ref.db ?? currentDbName;
        try {
            assertResourceAllowed(profileName, { dbName, collectionName: ref.collection });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Aggregation stage ${ref.stage} references ${dbName}.${ref.collection}: ${message}`);
        }
    }
}
