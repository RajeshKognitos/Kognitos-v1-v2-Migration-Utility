/**
 * Migration history (Phase 3.5+).
 *
 * Server component listing every persisted migration (newest first) with a link
 * back into its `/migration/[id]` viewer. Reads the store directly — no client
 * JS needed. Marked dynamic so it always reflects the latest DB state.
 */

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Coins,
  FileArchive,
  GitBranch,
  Loader2,
  Plug,
} from 'lucide-react';

import { listResults } from '@/lib/migration/store';
import type { MigrationSummary } from '@/lib/migration/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HistoryPage(): Promise<React.JSX.Element> {
  const migrations = await listResults();

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 transition hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            New migration
          </Link>
          <span className="text-sm text-neutral-400">
            {migrations.length} migration{migrations.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Migration history
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Past runs persisted locally. Open one to revisit its bundle, SOPs, and
          connection checklist.
        </p>

        {migrations.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="mt-6 space-y-3">
            {migrations.map((m) => (
              <li key={m.id}>
                <HistoryRow migration={m} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function HistoryRow({
  migration,
}: {
  migration: MigrationSummary;
}): React.JSX.Element {
  const running = migration.status === 'running';
  return (
    <Link
      href={`/migration/${migration.id}`}
      className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow-md"
    >
      <span
        className={[
          'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
          running ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600',
        ].join(' ')}
      >
        {running ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <FileArchive className="h-5 w-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neutral-900">
          {migration.harFilename}
        </p>
        <p className="text-xs text-neutral-400">
          {formatDate(migration.createdAt)}
        </p>
      </div>
      {running ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Running
        </span>
      ) : (
        <div className="hidden items-center gap-5 text-sm text-neutral-500 sm:flex">
          <Stat icon={<GitBranch className="h-4 w-4" />} value={migration.processCount} label="processes" />
          <Stat icon={<Plug className="h-4 w-4" />} value={migration.connectionCount} label="connections" />
          <Stat
            icon={<AlertTriangle className="h-4 w-4" />}
            value={migration.flagCount}
            label="flags"
          />
          <Stat icon={<Coins className="h-4 w-4" />} value={`$${migration.totalCostUsd.toFixed(2)}`} label="" />
        </div>
      )}
    </Link>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      <span className="font-medium text-neutral-700">{value}</span>
      {label && <span className="text-neutral-400">{label}</span>}
    </span>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        <FileArchive className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-neutral-900">
        No migrations yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">
        Run a migration and it&rsquo;ll show up here, ready to revisit after a
        restart.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        Start a migration
      </Link>
    </div>
  );
}

/** Format an ISO timestamp as a readable absolute date/time. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
