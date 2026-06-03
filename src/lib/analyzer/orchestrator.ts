/**
 * Bundle orchestrator (Phase 1, final piece).
 *
 * `analyzeBundle` wraps the single-process analyzer (`analyzeProcess`) to turn a
 * whole `ExtractedAgentBundle` into a map of validated `V1ProcessIR`s. It:
 *
 *  1. Topologically sorts the bundle's procedures leaves-first (MR-44) using the
 *     extractor's call graph, deferring any cycle nodes to the end.
 *  2. Analyzes them with a bounded concurrency pool (default 3).
 *  3. Resolves each `subprocess_call`'s `resolvableInBundle` against the bundle.
 *  4. Aggregates token usage into a USD cost, times each process, and emits
 *     progress events for a future streaming UI.
 *  5. Collects per-process failures without aborting the whole bundle.
 *
 * Strict TS, no `any`.
 */

import { randomUUID } from 'node:crypto';

import type { CallGraph, ExtractedAgentBundle } from '@/lib/har';
import type { StatementIR, V1ProcessIR } from '@/types/ir';

import { analyzeProcess } from './client';
import type { CallGraphContext } from './prompt';

/**
 * Default GPT-4o pricing (USD per 1M tokens) used when the caller does not
 * supply explicit rates. Update alongside model/pricing changes.
 */
export const DEFAULT_COST_RATES = {
  /** Input (prompt) tokens, USD per 1,000,000. */
  inputPerM: 2.5,
  /** Output (completion) tokens, USD per 1,000,000. */
  outputPerM: 10,
} as const;

/** A progress event emitted as the bundle is analyzed (for streaming UI). */
export interface ProgressEvent {
  /** Lifecycle phase this event represents. */
  type: 'started' | 'process_complete' | 'process_error' | 'done';
  /** The procedure this event concerns (absent for the final `done` event). */
  procedureId?: string;
  /** Wall-clock duration of the process analysis, for `process_complete`. */
  durationMs?: number;
  /** Error message, for `process_error`. */
  error?: string;
}

/** Options for {@link analyzeBundle}. */
export interface AnalyzeBundleOptions {
  /** Max number of processes analyzed in parallel. Defaults to 3. */
  concurrency?: number;
  /** Callback invoked for every {@link ProgressEvent}. */
  onProgress?: (event: ProgressEvent) => void;
  /** Token pricing (USD per 1M). Defaults to {@link DEFAULT_COST_RATES}. */
  costRates?: { inputPerM: number; outputPerM: number };
}

/** A per-process analysis failure (the bundle continues past it). */
export interface BundleAnalysisError {
  /** Procedure ID that failed. */
  procedureId: string;
  /** Human-readable procedure name. */
  procedureName: string;
  /** The failure message. */
  error: string;
}

/** The aggregated result of analyzing an entire bundle. */
export interface AnalyzedBundle {
  /** Stable bundle identifier (department ID when known, else a UUID). */
  bundleId: string;
  /** Successfully analyzed IRs, keyed by `procedureId`. */
  irs: Map<string, V1ProcessIR>;
  /** The input call graph, passed through unchanged. */
  callGraph: CallGraph;
  /** Timing breakdown. */
  timings: {
    /** Per-process wall-clock duration (ms), keyed by `procedureId`. */
    perProcessMs: Map<string, number>;
    /** Total wall-clock duration of the whole bundle analysis (ms). */
    totalMs: number;
  };
  /** Aggregated token usage and computed cost. */
  tokenUsage: {
    /** Sum of input (prompt) tokens across all processes. */
    totalInput: number;
    /** Sum of output (completion) tokens across all processes. */
    totalOutput: number;
    /** Computed cost in USD from the configured rates. */
    totalCostUsd: number;
  };
  /** Per-process failures (empty when everything succeeded). */
  errors: BundleAnalysisError[];
}

/**
 * Topologically order the call graph leaves-first (MR-44): for every edge
 * `parent → child`, the child is analyzed before the parent so a parent's SOP
 * can reference an already-migrated child.
 *
 * Cycle nodes (recursive chains) cannot be ordered; they are excluded from the
 * DAG traversal and appended at the end (in node order) for individual handling.
 *
 * @returns The full processing order plus the deferred cycle node IDs.
 */
function topologicalOrder(callGraph: CallGraph): {
  order: string[];
  cycleNodes: string[];
} {
  const cycleSet = new Set<string>(callGraph.cycles.flat());

  // Out-edges: parent → children.
  const adjacency = new Map<string, string[]>();
  for (const edge of callGraph.edges) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  const visited = new Set<string>();
  const order: string[] = [];

  // Post-order DFS over the DAG (cycle nodes excluded) yields children before
  // parents, i.e. leaves first.
  const visit = (id: string): void => {
    if (visited.has(id) || cycleSet.has(id)) return;
    visited.add(id);
    for (const child of adjacency.get(id) ?? []) {
      visit(child);
    }
    order.push(id);
  };

  for (const node of callGraph.nodes) {
    visit(node.id);
  }

  const cycleNodes = callGraph.nodes
    .filter((n) => cycleSet.has(n.id))
    .map((n) => n.id);

  return { order: [...order, ...cycleNodes], cycleNodes };
}

/**
 * Recursively walk a statement tree, setting `resolvableInBundle` on every
 * `subprocess_call` (true iff its `procedureId` exists in `bundleIds`). Mutates
 * the statements in place (the IR is freshly produced for this bundle).
 */
function resolveSubprocessCalls(
  statements: StatementIR[],
  bundleIds: Set<string>,
): void {
  for (const stmt of statements) {
    if (stmt.kind === 'subprocess_call') {
      stmt.resolvableInBundle =
        stmt.procedureId !== undefined && bundleIds.has(stmt.procedureId);
    } else if (stmt.kind === 'conditional') {
      resolveSubprocessCalls(stmt.thenBranch, bundleIds);
      if (stmt.elseBranch) resolveSubprocessCalls(stmt.elseBranch, bundleIds);
    } else if (stmt.kind === 'loop') {
      resolveSubprocessCalls(stmt.body, bundleIds);
    }
  }
}

/**
 * Run `worker` over `items` in order with at most `concurrency` in flight at
 * once. Workers pull from a shared cursor, so items are *started* in order
 * (children before parents) even though they may complete out of order.
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
 * Analyze every process in an extracted bundle into validated IR.
 *
 * Processes are analyzed leaves-first (MR-44) with bounded concurrency; a
 * single process failing is recorded in `errors` and does not abort the bundle.
 *
 * @param bundle The extracted agent bundle (from the HAR extractor).
 * @param opts   Concurrency, progress callback, and cost-rate overrides.
 */
export async function analyzeBundle(
  bundle: ExtractedAgentBundle,
  opts: AnalyzeBundleOptions = {},
): Promise<AnalyzedBundle> {
  const concurrency = opts.concurrency ?? 3;
  const costRates = opts.costRates ?? DEFAULT_COST_RATES;
  const emit = opts.onProgress ?? ((): void => {});

  const bundleId =
    bundle.sourceMeta.departmentId ?? randomUUID();

  const processById = new Map(bundle.processes.map((p) => [p.id, p]));
  const bundleIds = new Set(bundle.processes.map((p) => p.id));

  const { order, cycleNodes } = topologicalOrder(bundle.callGraph);
  if (cycleNodes.length > 0) {
    const names = cycleNodes
      .map((id) => processById.get(id)?.name ?? id)
      .join(', ');
    console.warn(
      `[orchestrator] ${cycleNodes.length} process(es) are in recursive cycles ` +
        `and will be analyzed individually at the end (MR-44): ${names}`,
    );
  }

  // Any node referenced by the graph that wasn't reached (e.g. a node missing
  // from edges entirely) is still covered because topologicalOrder visits every
  // node; but guard against an order/process mismatch by intersecting with the
  // actual processes.
  const orderedProcesses = order.filter((id) => processById.has(id));

  const irs = new Map<string, V1ProcessIR>();
  const perProcessMs = new Map<string, number>();
  const errors: BundleAnalysisError[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  const bundleStart = Date.now();

  await runWithConcurrency(orderedProcesses, concurrency, async (id) => {
    const proc = processById.get(id);
    if (!proc) return;

    emit({ type: 'started', procedureId: id });

    const context: CallGraphContext = {
      thisProcessName: proc.name,
      bundleSize: bundle.processes.length,
      siblingProcedures: bundle.processes
        .filter((p) => p.id !== id)
        .map((p) => ({ name: p.name, procedureId: p.id })),
    };

    const startedAt = Date.now();
    try {
      const { ir, tokens } = await analyzeProcess(proc.text, context);
      const durationMs = Date.now() - startedAt;

      for (const procedure of ir.procedures) {
        resolveSubprocessCalls(procedure.statements, bundleIds);
      }

      irs.set(id, ir);
      perProcessMs.set(id, durationMs);
      totalInput += tokens.input;
      totalOutput += tokens.output;

      emit({ type: 'process_complete', procedureId: id, durationMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      perProcessMs.set(id, Date.now() - startedAt);
      errors.push({
        procedureId: id,
        procedureName: proc.name,
        error: message,
      });
      console.error(
        `[orchestrator] failed to analyze "${proc.name}" (${id}): ${message}`,
      );
      emit({ type: 'process_error', procedureId: id, error: message });
    }
  });

  const totalMs = Date.now() - bundleStart;

  const totalCostUsd =
    (totalInput / 1_000_000) * costRates.inputPerM +
    (totalOutput / 1_000_000) * costRates.outputPerM;

  emit({ type: 'done' });

  return {
    bundleId,
    irs,
    callGraph: bundle.callGraph,
    timings: { perProcessMs, totalMs },
    tokenUsage: { totalInput, totalOutput, totalCostUsd },
    errors,
  };
}
