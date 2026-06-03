'use client';

/**
 * Pipeline progress stepper (Phase 3.5, FILE 5).
 *
 * Renders the three pipeline stages — Extract \u2192 Analyze \u2192 Generate SOPs — as
 * horizontal steps. Each stage shows pending (gray), active (blue spinner), or
 * complete (green check), with a sub-progress bar + "Analyzing 4/7" label for
 * the per-process work in the analyze/SOP stages.
 */

import { Cpu, FileArchive, FileText, Check, Loader2 } from 'lucide-react';

/** Lifecycle state of a single pipeline stage. */
export type StageStatus = 'pending' | 'active' | 'complete' | 'error';

/** One stage's display state. */
export interface StageState {
  status: StageStatus;
  /** Completed sub-units (processes), for active/complete stages. */
  completed: number;
  /** Total sub-units (processes). 0 hides the sub-progress bar. */
  total: number;
}

/** Props for {@link PipelineProgress}. */
export interface PipelineProgressProps {
  extract: StageState;
  analyze: StageState;
  sop: StageState;
}

interface StageMeta {
  key: keyof PipelineProgressProps;
  label: string;
  icon: React.ReactNode;
  /** Verb used in the sub-progress label, e.g. "Analyzing". */
  verb: string;
}

const STAGES: StageMeta[] = [
  { key: 'extract', label: 'Extract', icon: <FileArchive className="h-5 w-5" />, verb: 'Extracting' },
  { key: 'analyze', label: 'Analyze', icon: <Cpu className="h-5 w-5" />, verb: 'Analyzing' },
  { key: 'sop', label: 'Generate SOPs', icon: <FileText className="h-5 w-5" />, verb: 'Generating' },
];

export function PipelineProgress(props: PipelineProgressProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <ol className="flex items-start">
        {STAGES.map((meta, index) => {
          const state = props[meta.key];
          return (
            <li key={meta.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* Left connector */}
                <Connector visible={index > 0} done={state.status !== 'pending'} />
                <StageBadge status={state.status} icon={meta.icon} />
                {/* Right connector */}
                <Connector
                  visible={index < STAGES.length - 1}
                  done={state.status === 'complete'}
                />
              </div>

              <div className="mt-3 text-center">
                <p
                  className={[
                    'text-sm font-medium',
                    state.status === 'pending' ? 'text-neutral-400' : 'text-neutral-900',
                  ].join(' ')}
                >
                  {meta.label}
                </p>
                <SubProgress meta={meta} state={state} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StageBadge({
  status,
  icon,
}: {
  status: StageStatus;
  icon: React.ReactNode;
}): React.JSX.Element {
  const styles: Record<StageStatus, string> = {
    pending: 'border-neutral-200 bg-neutral-50 text-neutral-400',
    active: 'border-blue-600 bg-blue-50 text-blue-600',
    complete: 'border-green-600 bg-green-600 text-white',
    error: 'border-red-500 bg-red-50 text-red-600',
  };
  return (
    <span
      className={[
        'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 transition',
        styles[status],
      ].join(' ')}
    >
      {status === 'active' ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : status === 'complete' ? (
        <Check className="h-5 w-5" />
      ) : (
        icon
      )}
    </span>
  );
}

function Connector({ visible, done }: { visible: boolean; done: boolean }): React.JSX.Element {
  if (!visible) return <span className="flex-1" />;
  return (
    <span className="flex-1 px-1">
      <span
        className={[
          'block h-0.5 w-full rounded-full transition-colors',
          done ? 'bg-green-500' : 'bg-neutral-200',
        ].join(' ')}
      />
    </span>
  );
}

function SubProgress({
  meta,
  state,
}: {
  meta: StageMeta;
  state: StageState;
}): React.JSX.Element | null {
  if (state.total === 0 || state.status === 'pending') return null;
  const pct =
    state.status === 'complete'
      ? 100
      : Math.round((state.completed / Math.max(1, state.total)) * 100);
  const label =
    state.status === 'complete'
      ? `${state.total}/${state.total} done`
      : `${meta.verb} ${state.completed}/${state.total}`;
  return (
    <div className="mt-2 w-28">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={[
            'h-full rounded-full transition-all duration-500',
            state.status === 'complete' ? 'bg-green-500' : 'bg-blue-600',
          ].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">{label}</p>
    </div>
  );
}
