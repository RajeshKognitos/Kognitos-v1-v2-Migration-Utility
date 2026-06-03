'use client';

/**
 * History row (Phase 3.5+).
 *
 * Client component for one entry on the `/history` page: a card linking into the
 * migration viewer, plus an inline two-step delete control (click the trash →
 * confirm) that calls `DELETE /api/migrations/[id]` and refreshes the list.
 * Works for both completed runs and stale `running` rows left by interrupted
 * jobs.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Coins,
  FileArchive,
  GitBranch,
  Loader2,
  Plug,
  Trash2,
} from 'lucide-react';

import type { MigrationSummary } from '@/lib/migration/persistence';

/** Props for {@link HistoryRow}. */
export interface HistoryRowProps {
  migration: MigrationSummary;
}

export function HistoryRow({ migration }: HistoryRowProps): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const running = migration.status === 'running';

  const onDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/migrations/${migration.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.refresh();
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="relative">
      <Link
        href={`/migration/${migration.id}`}
        className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 pr-28 shadow-sm transition hover:shadow-md"
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
          <p className="truncate font-medium text-neutral-900">{migration.harFilename}</p>
          <p className="text-xs text-neutral-400">{formatDate(migration.createdAt)}</p>
        </div>
        {running ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running
          </span>
        ) : (
          <div className="hidden items-center gap-5 text-sm text-neutral-500 lg:flex">
            <Stat icon={<GitBranch className="h-4 w-4" />} value={migration.processCount} label="processes" />
            <Stat icon={<Plug className="h-4 w-4" />} value={migration.connectionCount} label="connections" />
            <Stat icon={<AlertTriangle className="h-4 w-4" />} value={migration.flagCount} label="flags" />
            <Stat icon={<Coins className="h-4 w-4" />} value={`$${migration.totalCostUsd.toFixed(2)}`} label="" />
          </div>
        )}
      </Link>

      {/* Delete control — a sibling of the Link (not nested) for valid markup. */}
      <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2">
        {confirming ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete migration ${migration.harFilename}`}
            title="Delete this migration"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-neutral-300 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
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
