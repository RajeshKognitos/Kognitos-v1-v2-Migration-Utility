'use client';

/**
 * Live activity feed for a running migration.
 *
 * Renders a scrolling, timestamped log of the pipeline's SSE events (stage
 * transitions, each analyzed process, each generated business-process SOP, and
 * the final outcome) so the long analyze/SOP stages aren't a blank screen. The
 * feed auto-scrolls to the newest line and shows a "working" pulse while active.
 *
 * Purely presentational: the parent ({@link import('@/app/migration/[id]/page')})
 * accumulates entries from the events it already consumes.
 */

import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Terminal } from 'lucide-react';

/** Severity of one log line, controlling its marker + color. */
export type LogLevel = 'info' | 'success' | 'error' | 'muted';

/** A single line in the activity feed. */
export interface LogEntry {
  /** Stable, unique key. */
  id: string;
  /** Epoch ms when the line was recorded. */
  ts: number;
  /** Severity / styling. */
  level: LogLevel;
  /** The human-readable message. */
  message: string;
}

/** Props for {@link ActivityLog}. */
export interface ActivityLogProps {
  entries: LogEntry[];
  /** True while the pipeline is actively streaming (shows the pulse). */
  active: boolean;
}

const LEVEL_TEXT: Record<LogLevel, string> = {
  info: 'text-neutral-300',
  success: 'text-emerald-300',
  error: 'text-red-300',
  muted: 'text-neutral-500',
};

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function Marker({ level }: { level: LogLevel }): React.JSX.Element {
  if (level === 'success') {
    return <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />;
  }
  if (level === 'error') {
    return <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />;
  }
  return (
    <span
      className={[
        'mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full',
        level === 'muted' ? 'bg-neutral-600' : 'bg-blue-400',
      ].join(' ')}
    />
  );
}

export function ActivityLog({ entries, active }: ActivityLogProps): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest line whenever the feed grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length]);

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <div className="flex items-center gap-2 text-neutral-300">
          <Terminal className="h-4 w-4" />
          <span className="text-sm font-medium">Activity</span>
        </div>
        {active && (
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            working
          </span>
        )}
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Migration activity log"
        className="max-h-72 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {entries.length === 0 ? (
          <p className="text-neutral-500">Waiting for the pipeline to start&hellip;</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2">
                <span className="select-none text-neutral-600">{timeLabel(entry.ts)}</span>
                <Marker level={entry.level} />
                <span className={LEVEL_TEXT[entry.level]}>{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
