/**
 * In-memory {@link MigrationStore} adapter.
 *
 * Process-global `Map` (hung off `globalThis` so it survives dev HMR). Used as a
 * test/edge fallback and when `MIGRATION_STORE=memory`. Lost on restart — which
 * is exactly why SQLite is the default for local dev.
 *
 * Strict TS, no `any`.
 */

import type { MigrationResult } from '@/lib/sse-client';
import {
  summarize,
  type MigrationStore,
  type MigrationSummary,
  type RunningMigration,
} from './types';

const STORE_KEY = Symbol.for('kognitos.migration.memory');

interface Entry {
  /** Full result; `null` while the run is still in progress. */
  result: MigrationResult | null;
  summary: MigrationSummary;
}

type Backing = Map<string, Entry>;

interface GlobalWithStore {
  [STORE_KEY]?: Backing;
}

function backing(): Backing {
  const g = globalThis as unknown as GlobalWithStore;
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map<string, Entry>();
  return g[STORE_KEY];
}

/** {@link MigrationStore} backed by a process-global `Map`. */
export class MemoryMigrationStore implements MigrationStore {
  async saveRunning(info: RunningMigration): Promise<void> {
    const existing = backing().get(info.id);
    backing().set(info.id, {
      result: existing?.result ?? null,
      summary: {
        id: info.id,
        harFilename: info.harFilename,
        processCount: info.processCount,
        connectionCount: 0,
        flagCount: 0,
        totalCostUsd: 0,
        createdAt: existing?.summary.createdAt ?? new Date().toISOString(),
        status: 'running',
      },
    });
  }

  async save(result: MigrationResult): Promise<void> {
    const existing = backing().get(result.id);
    const summary = summarize(result);
    backing().set(result.id, {
      result,
      // Preserve the original start time if we had a running record.
      summary: { ...summary, createdAt: existing?.summary.createdAt ?? summary.createdAt },
    });
  }

  async get(id: string): Promise<MigrationResult | null> {
    return backing().get(id)?.result ?? null;
  }

  async getSummary(id: string): Promise<MigrationSummary | null> {
    return backing().get(id)?.summary ?? null;
  }

  async list(): Promise<MigrationSummary[]> {
    return [...backing().values()]
      .map((e) => e.summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async delete(id: string): Promise<void> {
    backing().delete(id);
  }
}
