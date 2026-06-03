'use client';

/**
 * Process card grid (Phase 3.5, FILE 8).
 *
 * Responsive grid (1 / 2 / 3 columns) of process cards. Each card shows the
 * name, line count, book badges, subprocess count, and flag count, with a left
 * border colored by flag count (0 green, 1\u20132 yellow, 3+ orange). Clicking a card
 * opens the {@link ProcessDetail} panel via `onSelect`.
 */

import { AlertTriangle, GitBranch, Hash, Layers } from 'lucide-react';

import { flagBorderClass, type ProcessView } from '@/lib/bundle-view';

/** Props for {@link ProcessList}. */
export interface ProcessListProps {
  processes: ProcessView[];
  /** Invoked with the clicked process. */
  onSelect: (process: ProcessView) => void;
}

const ROLE_DOT: Record<ProcessView['role'], string> = {
  root: 'bg-blue-500',
  leaf: 'bg-neutral-400',
  intermediate: 'bg-purple-500',
};

const ROLE_LABEL: Record<ProcessView['role'], string> = {
  root: 'Entry point',
  leaf: 'Utility',
  intermediate: 'Intermediate',
};

export function ProcessList({
  processes,
  onSelect,
}: ProcessListProps): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {processes.map((process) => (
        <button
          key={process.id}
          type="button"
          onClick={() => onSelect(process)}
          className={[
            'flex flex-col rounded-lg border border-l-4 border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500',
            flagBorderClass(process.flags.length),
          ].join(' ')}
        >
          <div className="flex items-center gap-2">
            <span className={['h-2 w-2 flex-shrink-0 rounded-full', ROLE_DOT[process.role]].join(' ')} />
            <span className="text-xs font-medium text-neutral-400">
              {ROLE_LABEL[process.role]}
            </span>
            <span className="ml-auto rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
              {process.stage}
            </span>
          </div>

          <h3 className="mt-2 line-clamp-2 font-medium text-neutral-900">
            {process.name}
          </h3>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {process.books.length > 0 ? (
              process.books.map((book) => (
                <span
                  key={book}
                  className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                >
                  {book}
                </span>
              ))
            ) : (
              <span className="text-xs text-neutral-400">No books detected</span>
            )}
          </div>

          <div className="mt-4 flex items-center gap-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
            <Stat icon={<Hash className="h-3.5 w-3.5" />} value={process.lineCount} label="lines" />
            <Stat
              icon={<GitBranch className="h-3.5 w-3.5" />}
              value={process.subprocessCount}
              label="subs"
            />
            <Stat
              icon={
                process.flags.length > 0 ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <Layers className="h-3.5 w-3.5" />
                )
              }
              value={process.flags.length}
              label="flags"
            />
            {process.failed && (
              <span className="ml-auto rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">
                partial
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      <span className="font-medium text-neutral-700">{value}</span>
      <span>{label}</span>
    </span>
  );
}
