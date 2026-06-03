/**
 * Persistence factory — selects the {@link MigrationStore} backend.
 *
 * Backend resolution:
 *   - `MIGRATION_STORE` env wins when set (`supabase` | `sqlite` | `memory`).
 *   - else `supabase` when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set
 *     (the production path — Vercel can't persist SQLite's local file).
 *   - else `sqlite` (zero-config local dev).
 *
 * Adapters are loaded lazily via dynamic `import()` so the unused backend's deps
 * never enter the bundle — critically, the native `better-sqlite3` module is
 * never loaded in a Supabase/Vercel deployment. The resolved instance is
 * memoized on `globalThis` so every request shares one adapter (and connection).
 *
 * Strict TS, no `any`.
 */

import type { MigrationStore } from './types';

export type {
  MigrationStore,
  MigrationSummary,
  MigrationStatus,
  RunningMigration,
} from './types';

type Backend = 'memory' | 'sqlite' | 'supabase';

const INSTANCE_KEY = Symbol.for('kognitos.migration.store.instance');

interface GlobalWithInstance {
  [INSTANCE_KEY]?: Promise<MigrationStore>;
}

function chooseBackend(): Backend {
  const explicit = process.env.MIGRATION_STORE?.toLowerCase();
  if (explicit === 'memory' || explicit === 'sqlite' || explicit === 'supabase') {
    return explicit;
  }
  if (explicit) {
    console.warn(
      `[persistence] unknown MIGRATION_STORE="${explicit}", auto-detecting instead.`,
    );
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return 'supabase';
  }
  return 'sqlite';
}

async function create(): Promise<MigrationStore> {
  const backend = chooseBackend();
  switch (backend) {
    case 'memory': {
      const mod = await import('./memory');
      return new mod.MemoryMigrationStore();
    }
    case 'supabase': {
      const mod = await import('./supabase');
      return new mod.SupabaseMigrationStore();
    }
    case 'sqlite':
    default: {
      const mod = await import('./sqlite');
      return new mod.SqliteMigrationStore();
    }
  }
}

/** The shared {@link MigrationStore} for this server process (memoized). */
export function getStore(): Promise<MigrationStore> {
  const g = globalThis as unknown as GlobalWithInstance;
  if (!g[INSTANCE_KEY]) g[INSTANCE_KEY] = create();
  return g[INSTANCE_KEY];
}
