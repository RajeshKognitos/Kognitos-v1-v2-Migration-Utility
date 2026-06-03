/**
 * SOP bundle orchestrator (Phase 3).
 *
 * `generateBundleSops` wraps the single-process SOP generator to produce an SOP
 * + test plan for every IR in an `AnalyzedBundle`. It:
 *
 *  1. Generates SOPs with a bounded concurrency pool (3, matching the analyzer).
 *  2. Deduplicates ConnectionRequirements across all processes (the same
 *     integration mentioned by several processes collapses to one requirement).
 *  3. Aggregates token usage into a USD cost, times each process, and collects
 *     per-process failures without aborting the whole bundle.
 *
 * Strict TS, no `any`.
 */

import { DEFAULT_COST_RATES } from '@/lib/analyzer/orchestrator';
import type { AnalyzedBundle } from '@/lib/analyzer/orchestrator';
import type { ConnectionRequirement, SopGenerationResult } from '@/types/sop';

import { generateSopAndTestPlan } from './client';

/** A per-process SOP-generation failure (the bundle continues past it). */
export interface BundleSopError {
  /** Procedure ID that failed. */
  procedureId: string;
  /** Human-readable procedure name. */
  procedureName: string;
  /** The failure message. */
  error: string;
}

/** The aggregated result of generating SOPs for an entire analyzed bundle. */
export interface BundleSopResult {
  /** Successfully generated SOP results, keyed by `procedureId`. */
  sops: Map<string, SopGenerationResult>;
  /** Every required v2 Connection, deduplicated across all processes. */
  aggregatedConnections: ConnectionRequirement[];
  /** Aggregated token usage and computed cost. */
  tokenUsage: {
    /** Sum of input (prompt) tokens across all processes. */
    totalInput: number;
    /** Sum of output (completion) tokens across all processes. */
    totalOutput: number;
    /** Computed cost in USD from the configured rates. */
    totalCostUsd: number;
  };
  /** Timing breakdown. */
  timings: {
    /** Per-process wall-clock duration (ms), keyed by `procedureId`. */
    perProcessMs: Map<string, number>;
    /** Total wall-clock duration of the whole SOP run (ms). */
    totalMs: number;
  };
  /** Per-process failures (empty when everything succeeded). */
  errors: BundleSopError[];
}

/** Options for {@link generateBundleSops}. */
export interface GenerateBundleSopsOptions {
  /** Max number of SOPs generated in parallel. Defaults to 3. */
  concurrency?: number;
  /** Token pricing (USD per 1M). Defaults to the analyzer's GPT-4o rates. */
  costRates?: { inputPerM: number; outputPerM: number };
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
 * Generate SOPs + test plans for every process in an analyzed bundle.
 *
 * A single process failing is recorded in `errors` and does not abort the run.
 *
 * @param analyzedBundle The Phase 1 analyzer output.
 * @param opts           Concurrency and cost-rate overrides.
 */
export async function generateBundleSops(
  analyzedBundle: AnalyzedBundle,
  opts: GenerateBundleSopsOptions = {},
): Promise<BundleSopResult> {
  const concurrency = opts.concurrency ?? 3;
  const costRates = opts.costRates ?? DEFAULT_COST_RATES;

  const nameById = new Map(
    analyzedBundle.callGraph.nodes.map((n) => [n.id, n.name]),
  );
  const ids = [...analyzedBundle.irs.keys()];
  const allNames = ids.map((id) => nameById.get(id) ?? id);
  const bundleSummary = `part of a bundle of ${ids.length} process(es): ${allNames
    .map((n) => `"${n}"`)
    .join(', ')}.`;

  const sops = new Map<string, SopGenerationResult>();
  const connections = new Map<string, ConnectionRequirement>();
  const perProcessMs = new Map<string, number>();
  const errors: BundleSopError[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  const bundleStart = Date.now();

  await runWithConcurrency(ids, concurrency, async (id) => {
    const ir = analyzedBundle.irs.get(id);
    if (!ir) return;
    const procedureName =
      nameById.get(id) ?? ir.procedures[0]?.name ?? id;

    const startedAt = Date.now();
    try {
      const result = await generateSopAndTestPlan(ir, { bundleSummary });
      perProcessMs.set(id, Date.now() - startedAt);
      sops.set(id, result);
      mergeConnections(connections, result.connectionRequirements);
      totalInput += result.metadata.tokensUsed.input;
      totalOutput += result.metadata.tokensUsed.output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      perProcessMs.set(id, Date.now() - startedAt);
      errors.push({ procedureId: id, procedureName, error: message });
      console.error(
        `[sop-orchestrator] failed to generate SOP for "${procedureName}" (${id}): ${message}`,
      );
    }
  });

  const totalMs = Date.now() - bundleStart;
  const totalCostUsd =
    (totalInput / 1_000_000) * costRates.inputPerM +
    (totalOutput / 1_000_000) * costRates.outputPerM;

  return {
    sops,
    aggregatedConnections: [...connections.values()],
    tokenUsage: { totalInput, totalOutput, totalCostUsd },
    timings: { perProcessMs, totalMs },
    errors,
  };
}
