/**
 * SQLite {@link MigrationStore} adapter (local dev default).
 *
 * Single `migrations` table: a JSON `payload` column holds the full
 * {@link MigrationResult}, with denormalized summary columns so `list()` never
 * has to parse every blob (per `docs/13` §5, "same schema, JSON columns"). The
 * connection is a lazy `globalThis` singleton so it's reused across requests and
 * survives the dev server's hot reloads.
 *
 * better-sqlite3 is synchronous; the methods are `async` only to satisfy the
 * shared interface (and to keep async-capable backends like Supabase pluggable).
 *
 * Strict TS, no `any`.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

import type { MigrationResult } from '@/lib/sse-client';
import {
  summarize,
  type MigrationStore,
  type MigrationSummary,
  type RunningMigration,
} from './types';

const DB_KEY = Symbol.for('kognitos.migration.sqlite');

interface GlobalWithDb {
  [DB_KEY]?: SqliteDatabase;
}

/** Row shape for the summary columns selected by `list()` / `getSummary()`. */
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

const SUMMARY_COLUMNS =
  'id, har_filename, process_count, connection_count, flag_count, total_cost_usd, created_at, status';

function dbFilePath(): string {
  const override = process.env.MIGRATION_DB_PATH;
  if (override) return override;
  return path.join(process.cwd(), 'data', 'migrations.db');
}

function connect(): SqliteDatabase {
  const g = globalThis as unknown as GlobalWithDb;
  if (g[DB_KEY]) return g[DB_KEY];

  const file = dbFilePath();
  mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id               TEXT    PRIMARY KEY,
      har_filename     TEXT    NOT NULL,
      process_count    INTEGER NOT NULL,
      connection_count INTEGER NOT NULL,
      flag_count       INTEGER NOT NULL,
      total_cost_usd   REAL    NOT NULL,
      created_at       TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'complete',
      payload          TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_migrations_created_at
      ON migrations (created_at DESC);
  `);

  // Migrate older DBs that predate the status column.
  const columns = db
    .prepare('PRAGMA table_info(migrations)')
    .all() as { name: string }[];
  if (!columns.some((c) => c.name === 'status')) {
    db.exec(
      "ALTER TABLE migrations ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'",
    );
  }

  g[DB_KEY] = db;
  return db;
}

/** {@link MigrationStore} backed by a local SQLite database file. */
export class SqliteMigrationStore implements MigrationStore {
  async saveRunning(info: RunningMigration): Promise<void> {
    // Insert a placeholder row; if one already exists, refresh the known fields
    // but never clobber an existing payload (e.g. a re-run before completion).
    connect()
      .prepare(
        `INSERT INTO migrations
           (id, har_filename, process_count, connection_count, flag_count, total_cost_usd, created_at, status, payload)
         VALUES
           (@id, @harFilename, @processCount, 0, 0, 0, @createdAt, 'running', '')
         ON CONFLICT(id) DO UPDATE SET
           har_filename  = excluded.har_filename,
           process_count = excluded.process_count,
           status        = 'running'`,
      )
      .run({
        id: info.id,
        harFilename: info.harFilename,
        processCount: info.processCount,
        createdAt: new Date().toISOString(),
      });
  }

  async save(result: MigrationResult): Promise<void> {
    const summary = summarize(result);
    // On completion, keep the original (start) created_at when a running row
    // already exists, so ordering reflects when the run began.
    connect()
      .prepare(
        `INSERT INTO migrations
           (id, har_filename, process_count, connection_count, flag_count, total_cost_usd, created_at, status, payload)
         VALUES
           (@id, @harFilename, @processCount, @connectionCount, @flagCount, @totalCostUsd, @createdAt, 'complete', @payload)
         ON CONFLICT(id) DO UPDATE SET
           har_filename     = excluded.har_filename,
           process_count    = excluded.process_count,
           connection_count = excluded.connection_count,
           flag_count       = excluded.flag_count,
           total_cost_usd   = excluded.total_cost_usd,
           status           = 'complete',
           payload          = excluded.payload`,
      )
      .run({
        id: summary.id,
        harFilename: summary.harFilename,
        processCount: summary.processCount,
        connectionCount: summary.connectionCount,
        flagCount: summary.flagCount,
        totalCostUsd: summary.totalCostUsd,
        createdAt: summary.createdAt,
        payload: JSON.stringify(result),
      });
  }

  async get(id: string): Promise<MigrationResult | null> {
    const row = connect()
      .prepare(
        "SELECT payload FROM migrations WHERE id = ? AND status = 'complete'",
      )
      .get(id) as { payload: string } | undefined;
    if (!row || !row.payload) return null;
    return JSON.parse(row.payload) as MigrationResult;
  }

  async getSummary(id: string): Promise<MigrationSummary | null> {
    const row = connect()
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM migrations WHERE id = ?`)
      .get(id) as SummaryRow | undefined;
    return row ? toSummary(row) : null;
  }

  async list(): Promise<MigrationSummary[]> {
    const rows = connect()
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM migrations ORDER BY created_at DESC`,
      )
      .all() as SummaryRow[];
    return rows.map(toSummary);
  }

  async delete(id: string): Promise<void> {
    connect().prepare('DELETE FROM migrations WHERE id = ?').run(id);
  }
}
