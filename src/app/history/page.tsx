/**
 * Migration history (Phase 3.5+).
 *
 * Server component listing every persisted migration (newest first) with a link
 * back into its `/migration/[id]` viewer. Reads the store directly — no client
 * JS needed. Marked dynamic so it always reflects the latest DB state.
 */

import Link from 'next/link';
import { ArrowLeft, FileArchive } from 'lucide-react';

import { HistoryRow } from '@/components/history/HistoryRow';
import { listResults } from '@/lib/migration/store';

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
