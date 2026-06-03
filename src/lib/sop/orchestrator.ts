/**
 * SOP bundle orchestrator (Phase 3).
 *
 * `generateBundleSops` produces ONE consolidated SOP + end-to-end test plan per
 * process GROUP (a weakly-connected component of the call graph). It:
 *
 *  1. Groups the bundle into connected components ({@link groupByComponent}).
 *  2. Generates a consolidated SOP per group with a bounded concurrency pool.
 *  3. Deduplicates ConnectionRequirements across all groups (the same
 *     integration used by several processes collapses to one requirement).
 *  4. Aggregates token usage into a USD cost, times each group, and collects
 *     per-group failures without aborting the whole bundle.
 *
 * Strict TS, no `any`.
 */

import { DEFAULT_COST_RATES } from '@/lib/analyzer/orchestrator';
import type { AnalyzedBundle } from '@/lib/analyzer/orchestrator';
import type { ConnectionRequirement, GroupSopResult } from '@/types/sop';

import { generateGroupSop } from './client';
import { groupByComponent } from './grouping';

/** A per-group SOP-generation failure (the bundle continues past it). */
export interface BundleSopError {
  /** Group id that failed. */
  groupId: string;
  /** Entry-point process name of the failed group. */
  entryName: string;
  /** The failure message. */
  error: string;
}

/** The aggregated result of generating SOPs for an entire analyzed bundle. */
export interface BundleSopResult {
  /** Successfully generated consolidated SOP results, one per group. */
  groups: GroupSopResult[];
  /** Every required v2 Connection, deduplicated across all groups. */
  aggregatedConnections: ConnectionRequirement[];
  /** Aggregated token usage and computed cost. */
  tokenUsage: {
    /** Sum of input (prompt) tokens across all groups. */
    totalInput: number;
    /** Sum of output (completion) tokens across all groups. */
    totalOutput: number;
    /** Computed cost in USD from the configured rates. */
    totalCostUsd: number;
  };
  /** Timing breakdown. */
  timings: {
    /** Per-group wall-clock duration (ms), keyed by `groupId`. */
    perGroupMs: Map<string, number>;
    /** Total wall-clock duration of the whole SOP run (ms). */
    totalMs: number;
  };
  /** Per-group failures (empty when everything succeeded). */
  errors: BundleSopError[];
}

/**
 * A progress event emitted as the bundle's group SOPs are generated (for
 * streaming UI).
 */
export interface SopProgressEvent {
  /** Lifecycle phase this event represents. */
  type: 'started' | 'group_complete' | 'group_error';
  /** The group this event concerns. */
  groupId: string;
  /** Entry-point process name of the group. */
  entryName: string;
  /** Wall-clock duration of the SOP generation, for `group_complete`. */
  durationMs?: number;
  /** Error message, for `group_error`. */
  error?: string;
}

/** Options for {@link generateBundleSops}. */
export interface GenerateBundleSopsOptions {
  /** Max number of group SOPs generated in parallel. Defaults to 3. */
  concurrency?: number;
  /** Token pricing (USD per 1M). Defaults to the analyzer's GPT-4o rates. */
  costRates?: { inputPerM: number; outputPerM: number };
  /** Callback invoked for every {@link SopProgressEvent}. */
  onProgress?: (event: SopProgressEvent) => void;
  /** Process owners keyed by procedure id (for the SOP Roles section). */
  ownersById?: Map<string, string | null>;
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight at once.
 * Workers pull from a shared cursor; items may complete out of order.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  const runLane = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: lanes }, () => runLane()));
}

/**
 * Merge a process's connection requirements into the running deduped map.
 * Dedup key is the lowercased integration name. When the same integration
 * appears more than once, `isCustomActionsIntegration` is OR-ed and reasons are
 * combined (deduped) so no rationale is lost.
 */
function mergeConnections(
  into: Map<string, ConnectionRequirement>,
  reqs: ConnectionRequirement[],
): void {
  for (const req of reqs) {
    const key = req.integration.trim().toLowerCase();
    const existing = into.get(key);
    if (!existing) {
      into.set(key, { ...req });
      continue;
    }
    existing.isCustomActionsIntegration =
      existing.isCustomActionsIntegration || req.isCustomActionsIntegration;
    if (req.reason && !existing.reason.includes(req.reason)) {
      existing.reason = `${existing.reason}; ${req.reason}`;
    }
    if (!existing.setupUrl && req.setupUrl) existing.setupUrl = req.setupUrl;
  }
}

/**
 * Generate a consolidated SOP + end-to-end test plan per process group.
 *
 * A single group failing is recorded in `errors` and does not abort the run.
 *
 * @param analyzedBundle The Phase 1 analyzer output.
 * @param opts           Concurrency, cost-rate, owners, and progress overrides.
 */
export async function generateBundleSops(
  analyzedBundle: AnalyzedBundle,
  opts: GenerateBundleSopsOptions = {},
): Promise<BundleSopResult> {
  const concurrency = opts.concurrency ?? 3;
  const costRates = opts.costRates ?? DEFAULT_COST_RATES;
  const emit = opts.onProgress ?? ((): void => {});
  const ownersById = opts.ownersById;

  const callGraph = analyzedBundle.callGraph;
  const nameById = new Map(callGraph.nodes.map((n) => [n.id, n.name]));
  const groups = groupByComponent(callGraph);

  const results: GroupSopResult[] = [];
  const connections = new Map<string, ConnectionRequirement>();
  const perGroupMs = new Map<string, number>();
  const errors: BundleSopError[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  const bundleStart = Date.now();

  await runWithConcurrency(groups, concurrency, async (group) => {
    const entryName = nameById.get(group.entryIds[0]) ?? group.entryIds[0];

    // Skip groups whose members all failed analysis (no IR to work from).
    const hasAnyIr = group.memberIds.some((id) => analyzedBundle.irs.has(id));
    if (!hasAnyIr) {
      errors.push({
        groupId: group.groupId,
        entryName,
        error: 'No analyzed IR available for any process in this group.',
      });
      emit({
        type: 'group_error',
        groupId: group.groupId,
        entryName,
        error: 'No analyzed IR available.',
      });
      return;
    }

    emit({ type: 'started', groupId: group.groupId, entryName });

    const startedAt = Date.now();
    try {
      const result = await generateGroupSop({
        group,
        irsById: analyzedBundle.irs,
        nameById,
        callGraph,
        ownersById,
      });
      const durationMs = Date.now() - startedAt;
      perGroupMs.set(group.groupId, durationMs);
      results.push(result);
      mergeConnections(connections, result.connectionRequirements);
      totalInput += result.metadata.tokensUsed.input;
      totalOutput += result.metadata.tokensUsed.output;
      emit({
        type: 'group_complete',
        groupId: group.groupId,
        entryName,
        durationMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      perGroupMs.set(group.groupId, Date.now() - startedAt);
      errors.push({ groupId: group.groupId, entryName, error: message });
      console.error(
        `[sop-orchestrator] failed to generate SOP for group "${entryName}" (${group.groupId}): ${message}`,
      );
      emit({
        type: 'group_error',
        groupId: group.groupId,
        entryName,
        error: message,
      });
    }
  });

  const totalMs = Date.now() - bundleStart;
  const totalCostUsd =
    (totalInput / 1_000_000) * costRates.inputPerM +
    (totalOutput / 1_000_000) * costRates.outputPerM;

  return {
    groups: results,
    aggregatedConnections: [...connections.values()],
    tokenUsage: { totalInput, totalOutput, totalCostUsd },
    timings: { perGroupMs, totalMs },
    errors,
  };
}
