/**
 * Migration result persistence + serialization (Phase 3.5+).
 *
 * Thin facade over the pluggable {@link MigrationStore} (SQLite locally; swap to
 * Supabase later via `MIGRATION_STORE`). Keeps {@link serializeMigrationResult}
 * — the code that flattens the three orchestrator outputs into one JSON-safe
 * {@link MigrationResult} — colocated with the save/get/list entry points.
 *
 * Strict TS, no `any`. Server-only (imports orchestrator output types).
 */

import type { ExtractedAgentBundle } from '@/lib/har';
import type { AnalyzedBundle } from '@/lib/analyzer/orchestrator';
import type { BundleSopResult } from '@/lib/sop';
import type { MigrationResult } from '@/lib/sse-client';

import {
  getStore,
  type MigrationSummary,
  type RunningMigration,
} from './persistence';

/** Mark a run as in-progress (before its result exists). */
export async function saveRunning(info: RunningMigration): Promise<void> {
  const store = await getStore();
  await store.saveRunning(info);
}

/** Persist a completed result under `result.id` (upsert; flips to complete). */
export async function saveResult(result: MigrationResult): Promise<void> {
  const store = await getStore();
  await store.save(result);
}

/** Retrieve a completed result by id, or `null` if unknown / still running. */
export async function getResult(id: string): Promise<MigrationResult | null> {
  const store = await getStore();
  return store.get(id);
}

/** Retrieve the summary row (incl. status) for `id`, or `null` if unknown. */
export async function getSummary(id: string): Promise<MigrationSummary | null> {
  const store = await getStore();
  return store.getSummary(id);
}

/** List all persisted migrations, newest first. */
export async function listResults(): Promise<MigrationSummary[]> {
  const store = await getStore();
  return store.list();
}

/** Delete a persisted migration by id. */
export async function deleteResult(id: string): Promise<void> {
  const store = await getStore();
  await store.delete(id);
}

/**
 * Flatten the three pipeline stages into a single JSON-safe
 * {@link MigrationResult}. Converts every orchestrator `Map` to a plain record.
 */
export function serializeMigrationResult(
  id: string,
  bundle: ExtractedAgentBundle,
  analyzed: AnalyzedBundle,
  sop: BundleSopResult,
): MigrationResult {
  return {
    id,
    bundle: {
      harFilename: bundle.sourceMeta.harFilename,
      departmentId: bundle.sourceMeta.departmentId,
      processCount: bundle.processes.length,
      callGraph: bundle.callGraph,
      detectedBooks: bundle.detectedBooks,
      warnings: bundle.warnings,
      processes: bundle.processes,
    },
    analysis: {
      tokenUsage: analyzed.tokenUsage,
      totalMs: analyzed.timings.totalMs,
      errors: analyzed.errors,
      irsById: Object.fromEntries(analyzed.irs),
      perProcessMs: Object.fromEntries(analyzed.timings.perProcessMs),
    },
    sop: {
      tokenUsage: sop.tokenUsage,
      totalMs: sop.timings.totalMs,
      errors: sop.errors,
      groups: sop.groups,
      perGroupMs: Object.fromEntries(sop.timings.perGroupMs),
      aggregatedConnections: sop.aggregatedConnections,
    },
  };
}
