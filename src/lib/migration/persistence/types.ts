/**
 * Persistence layer contract for migration results (Phase 3.5+).
 *
 * A {@link MigrationStore} abstracts *where* results live so the same call sites
 * work against SQLite (local dev, now), an in-memory map (tests), or a future
 * Supabase/Postgres backend (just add an adapter implementing this interface).
 * Per `docs/13` §5 the canonical record is keyed by migration id with a JSON
 * payload; summary columns back the lightweight {@link MigrationSummary} list.
 *
 * Strict TS, no `any`.
 */

import type { MigrationResult } from '@/lib/sse-client';

/** Lifecycle status of a stored migration. */
export type MigrationStatus = 'running' | 'complete';

/** Lightweight row for listing past migrations without parsing the full blob. */
export interface MigrationSummary {
  /** Migration id (also the `/migration/[id]` route segment). */
  id: string;
  /** Original HAR filename. */
  harFilename: string;
  /** Number of processes in the bundle. */
  processCount: number;
  /** Distinct v2 Connections required across the bundle (0 while running). */
  connectionCount: number;
  /** Total migration flags across all processes (0 while running). */
  flagCount: number;
  /** Combined analyze + SOP cost in USD (0 while running). */
  totalCostUsd: number;
  /** ISO-8601 timestamp the run started / the record was first written. */
  createdAt: string;
  /** Whether the run is still in progress or has a persisted result. */
  status: MigrationStatus;
}

/** Minimal info written when a run starts, before its result exists. */
export interface RunningMigration {
  /** Migration id. */
  id: string;
  /** Original HAR filename. */
  harFilename: string;
  /** Number of processes detected at extraction. */
  processCount: number;
}

/** Pluggable persistence backend for {@link MigrationResult}s. */
export interface MigrationStore {
  /** Record (or refresh) a run as in-progress, before its result exists. */
  saveRunning(info: RunningMigration): Promise<void>;
  /** Upsert a completed result (keyed by `result.id`); flips status to complete. */
  save(result: MigrationResult): Promise<void>;
  /** Fetch a completed result by id, or `null` when unknown or still running. */
  get(id: string): Promise<MigrationResult | null>;
  /** Fetch the summary row (incl. status) for `id`, or `null` when unknown. */
  getSummary(id: string): Promise<MigrationSummary | null>;
  /** List all stored migrations, newest first. */
  list(): Promise<MigrationSummary[]>;
  /** Remove a result by id (no-op if absent). */
  delete(id: string): Promise<void>;
}

/** Derive the summary row for a result (shared by every adapter). */
export function summarize(result: MigrationResult): MigrationSummary {
  const flagCount = Object.values(result.analysis.irsById).reduce(
    (total, ir) =>
      total +
      ir.flags.length +
      ir.procedures.reduce((n, p) => n + p.flags.length, 0),
    0,
  );
  return {
    id: result.id,
    harFilename: result.bundle.harFilename,
    processCount: result.bundle.processCount,
    connectionCount: result.sop.aggregatedConnections.length,
    flagCount,
    totalCostUsd:
      result.analysis.tokenUsage.totalCostUsd +
      result.sop.tokenUsage.totalCostUsd,
    createdAt: new Date().toISOString(),
    status: 'complete',
  };
}
