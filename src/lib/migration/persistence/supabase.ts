/**
 * Supabase (Postgres) {@link MigrationStore} adapter — the production backend.
 *
 * One `migrations` table with a `jsonb` payload + denormalized summary columns
 * (same shape as the SQLite dev adapter, per `docs/13` §5). Selected by the
 * factory when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are present (or
 * `MIGRATION_STORE=supabase`). Uses the service-role key, so it runs server-side
 * only and bypasses RLS.
 *
 * `created_at` is never written by the app: the column defaults to `now()` and
 * is left untouched on completion, so it always reflects when the run began.
 *
 * Strict TS, no `any`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { MigrationResult } from '@/lib/sse-client';
import {
  summarize,
  type MigrationStore,
  type MigrationSummary,
  type RunningMigration,
} from './types';

const TABLE = 'migrations';
const CLIENT_KEY = Symbol.for('kognitos.migration.supabase');

interface GlobalWithClient {
  [CLIENT_KEY]?: SupabaseClient;
}

/** Row shape returned for summary selects (snake_case Postgres columns). */
interface SummaryRow {
  id: string;
  har_filename: string;
  process_count: number;
  connection_count: number;
  flag_count: number;
  total_cost_usd: number;
  created_at: string;
  status: string;
}

const SUMMARY_COLUMNS =
  'id, har_filename, process_count, connection_count, flag_count, total_cost_usd, created_at, status';

function toSummary(r: SummaryRow): MigrationSummary {
  return {
    id: r.id,
    harFilename: r.har_filename,
    processCount: r.process_count,
    connectionCount: r.connection_count,
    flagCount: r.flag_count,
    totalCostUsd: r.total_cost_usd,
    createdAt: r.created_at,
    status: r.status === 'running' ? 'running' : 'complete',
  };
}

function client(): SupabaseClient {
  const g = globalThis as unknown as GlobalWithClient;
  if (g[CLIENT_KEY]) return g[CLIENT_KEY];

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase store selected but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.',
    );
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  g[CLIENT_KEY] = supabase;
  return supabase;
}

/** {@link MigrationStore} backed by a Supabase Postgres table. */
export class SupabaseMigrationStore implements MigrationStore {
  async saveRunning(info: RunningMigration): Promise<void> {
    // Only the known-at-start columns; on conflict the unspecified columns
    // (payload, created_at) are preserved, and on insert they take DB defaults.
    const { error } = await client()
      .from(TABLE)
      .upsert(
        {
          id: info.id,
          har_filename: info.harFilename,
          process_count: info.processCount,
          status: 'running',
        },
        { onConflict: 'id' },
      );
    if (error) throw new Error(`Supabase saveRunning failed: ${error.message}`);
  }

  async save(result: MigrationResult): Promise<void> {
    const summary = summarize(result);
    // created_at intentionally omitted so an existing (start) timestamp survives.
    const { error } = await client()
      .from(TABLE)
      .upsert(
        {
          id: summary.id,
          har_filename: summary.harFilename,
          process_count: summary.processCount,
          connection_count: summary.connectionCount,
          flag_count: summary.flagCount,
          total_cost_usd: summary.totalCostUsd,
          status: 'complete',
          payload: result,
        },
        { onConflict: 'id' },
      );
    if (error) throw new Error(`Supabase save failed: ${error.message}`);
  }

  async get(id: string): Promise<MigrationResult | null> {
    const { data, error } = await client()
      .from(TABLE)
      .select('payload')
      .eq('id', id)
      .eq('status', 'complete')
      .maybeSingle();
    if (error) throw new Error(`Supabase get failed: ${error.message}`);
    const row = data as { payload: MigrationResult | null } | null;
    return row?.payload ?? null;
  }

  async getSummary(id: string): Promise<MigrationSummary | null> {
    const { data, error } = await client()
      .from(TABLE)
      .select(SUMMARY_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Supabase getSummary failed: ${error.message}`);
    return data ? toSummary(data as unknown as SummaryRow) : null;
  }

  async list(): Promise<MigrationSummary[]> {
    const { data, error } = await client()
      .from(TABLE)
      .select(SUMMARY_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Supabase list failed: ${error.message}`);
    return (data as unknown as SummaryRow[]).map(toSummary);
  }

  async delete(id: string): Promise<void> {
    const { error } = await client().from(TABLE).delete().eq('id', id);
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
  }
}
