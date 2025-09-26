/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Execution plan analysis utilities. Translated and extended from prior Python prototype.
 * Focus (initial): single find() explain('executionStats') results.
 */

export interface FindExplainAnalysis {
  summary: string;
  keyMetrics: {
    executionTimeMillis?: number;
    totalDocsExamined?: number;
    totalKeysExamined?: number;
    nReturned?: number;
    indexEfficiency?: number | null; // keysExamined / docsExamined (when both present)
    docsExaminedPerReturn?: number | null; // docsExamined / nReturned
  };
  winningPlanStages: string[];
  indexUse: {
    usedIndex: boolean;
    indexNames: string[];
    fullCollectionScan: boolean;
    filterPushedDown: boolean | null;
  };
  coverage: {
    isCoveredQuery: boolean;
    reason: string;
  };
  recommendations: string[];
  rawPath?: string; // path of the winning execution plan (debug aid)
}

/** Narrow shape of a MongoDB find explain executionStats that we rely on */
interface ExecutionStatsLike {
  executionTimeMillis?: number;
  totalDocsExamined?: number;
  totalKeysExamined?: number;
  nReturned?: number;
  executionStages?: any;
}

/**
 * Recursively walk a plan subtree collecting stage names and index info.
 */
function walkStages(node: any, acc: { stages: string[]; indexNames: Set<string>; collectionScans: number; filterPushed: boolean; path: string[] }, path: string[] = []): void {
  if (!node || typeof node !== 'object') return;
  const stage = node.stage as string | undefined;
  if (stage) {
    acc.stages.push(stage);
    acc.path = path.concat(stage);
    if (stage === 'COLLSCAN') acc.collectionScans += 1;
  }
  // indexName can appear in IXSCAN or FETCH (for covered queries) etc
  if (node.indexName) {
    acc.indexNames.add(String(node.indexName));
  }
  // Filter pushdown heuristics
  if (stage === 'IXSCAN' && node.filter) {
    acc.filterPushed = true;
  }
  if (stage === 'FETCH' && node.filter && !acc.filterPushed) {
    // Filter applied after index scan
    acc.filterPushed = false;
  }
  // Explore common child container fields
  const childKeys = ['inputStage', 'inputStages', 'executionStages', 'shards', 'winningPlan', 'innerStage', 'outerStage'];
  for (const key of childKeys) {
    const child = (node as any)[key];
    if (!child) continue;
    if (Array.isArray(child)) {
      child.forEach((c, i) => walkStages(c, acc, path.concat(`${stage ?? 'ROOT'}[${i}]`)));
    } else {
      walkStages(child, acc, path.concat(stage ?? 'ROOT'));
    }
  }
  // Generic children enumeration (fallback) - avoid infinite recursion by skipping primitives & already handled fields
  for (const [k, v] of Object.entries(node)) {
    if (childKeys.includes(k)) continue;
    if (!v || typeof v !== 'object') continue;
    // Recognize pipeline array inside SUBPLANs or similar wrappers
    if (Array.isArray(v)) {
      v.forEach((c, i) => walkStages(c, acc, path.concat(`${stage ?? 'ROOT'}:${k}[${i}]`)));
    } else if ((v as any).stage) {
      walkStages(v, acc, path.concat(`${stage ?? 'ROOT'}:${k}`));
    }
  }
}

function computeCoverage(explain: any): { isCoveredQuery: boolean; reason: string } {
  // Covered query heuristic: presence of IXSCAN with no FETCH stage OR a FETCH with need for document fetch
  // We simplify: if plan has IXSCAN and no FETCH, treat as covered.
  const stages: string[] = [];
  const acc = { stages, indexNames: new Set<string>(), collectionScans: 0, filterPushed: false, path: [] as string[] };
  const winning = explain?.queryPlanner?.winningPlan || explain?.executionStats?.executionStages;
  walkStages(winning, acc);
  const hasIx = stages.includes('IXSCAN');
  const hasFetch = stages.includes('FETCH');
  if (hasIx && !hasFetch) {
    return { isCoveredQuery: true, reason: 'Winning plan uses only index scan stages (no FETCH).' };
  }
  if (!hasIx) {
    return { isCoveredQuery: false, reason: 'No index scan stages detected.' };
  }
  return { isCoveredQuery: false, reason: 'Index used but FETCH present (requires document fetch).' };
}

function buildRecommendations(metrics: { totalDocsExamined?: number; totalKeysExamined?: number; nReturned?: number }, details: { fullCollectionScan: boolean; usedIndex: boolean; coverage: { isCoveredQuery: boolean }; filterPushedDown: boolean | null }): string[] {
  const recs: string[] = [];
  const { totalDocsExamined, totalKeysExamined, nReturned } = metrics;
  if (details.fullCollectionScan) {
    recs.push('Query performed a collection scan. Consider creating an index that matches the filter and sort fields.');
  }
  if (!details.coverage.isCoveredQuery && details.usedIndex) {
    recs.push('Index used but not covered; consider projecting only indexed fields or adding needed fields to a compound index.');
  }
  if (nReturned !== undefined && totalDocsExamined !== undefined) {
    const ratio = totalDocsExamined / Math.max(1, nReturned);
    if (ratio > 100) {
      recs.push(`High documents examined per returned document (${ratio.toFixed(1)}). Refine filter or add a more selective index.`);
    }
  }
  if (details.usedIndex && details.filterPushedDown === false) {
    recs.push('Filter not fully pushed to index; consider reorganizing query predicates to allow index bounds.');
  }
  if (!details.usedIndex && !details.fullCollectionScan) {
    recs.push('No index usage detected. Verify query shape or available indexes.');
  }
  if (totalDocsExamined !== undefined && totalKeysExamined !== undefined && totalDocsExamined > 0) {
    const efficiency = totalKeysExamined / totalDocsExamined;
    if (efficiency > 10) {
      recs.push('High keys examined to docs examined ratio; ensure index matches predicate order and selectivity.');
    }
  }
  if (recs.length === 0) recs.push('Execution plan appears efficient for the provided dataset size.');
  return recs;
}

export function analyzeFindExplain(explain: any, query: Record<string, any>, options: Record<string, any>): FindExplainAnalysis {
  const exec: ExecutionStatsLike | undefined = explain?.executionStats;
  const metrics = {
    executionTimeMillis: exec?.executionTimeMillis,
    totalDocsExamined: exec?.totalDocsExamined,
    totalKeysExamined: exec?.totalKeysExamined,
    nReturned: exec?.nReturned
  };

  const winning = explain?.queryPlanner?.winningPlan || exec?.executionStages;
  const stages: string[] = [];
  const acc = { stages, indexNames: new Set<string>(), collectionScans: 0, filterPushed: false, path: [] as string[] };
  walkStages(winning, acc);

  const coverage = computeCoverage(explain);
  const usedIndex = acc.indexNames.size > 0 || stages.includes('IXSCAN');
  const fullCollectionScan = stages.includes('COLLSCAN');
  const filterPushedDown = acc.filterPushed ? true : (acc.filterPushed === false ? false : null);

  const indexEfficiency = (metrics.totalDocsExamined && metrics.totalKeysExamined && metrics.totalDocsExamined > 0)
    ? metrics.totalKeysExamined / metrics.totalDocsExamined
    : null;
  const docsExaminedPerReturn = (metrics.nReturned && metrics.totalDocsExamined && metrics.nReturned > 0)
    ? metrics.totalDocsExamined / metrics.nReturned
    : null;

  const recommendations = buildRecommendations(metrics, { fullCollectionScan, usedIndex, coverage, filterPushedDown });

  const summaryParts: string[] = [];
  if (fullCollectionScan) summaryParts.push('Collection scan');
  if (usedIndex) summaryParts.push('Index used');
  if (coverage.isCoveredQuery) summaryParts.push('Covered query');
  if (indexEfficiency !== null) summaryParts.push(`IndexEfficiency=${indexEfficiency.toFixed(2)}`);
  if (docsExaminedPerReturn !== null) summaryParts.push(`DocsPerReturn=${docsExaminedPerReturn.toFixed(1)}`);

  return {
    summary: summaryParts.join('; ') || 'Execution plan analyzed',
    keyMetrics: { ...metrics, indexEfficiency, docsExaminedPerReturn },
    winningPlanStages: stages,
    indexUse: {
      usedIndex,
      indexNames: Array.from(acc.indexNames),
      fullCollectionScan,
      filterPushedDown
    },
    coverage,
    recommendations,
    rawPath: acc.path.join(' > ')
  };
}
