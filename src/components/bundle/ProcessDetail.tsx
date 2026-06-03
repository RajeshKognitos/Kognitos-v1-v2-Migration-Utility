'use client';

/**
 * Process detail slide-out panel (Phase 3.5, FILE 9).
 *
 * Right-side drawer (full-screen sheet on mobile) for one {@link ProcessView}:
 * header, the rendered SOP markdown with a one-tap "Copy SOP" button, the test
 * plan, this process's connection requirements, its flags, and the original v1
 * source (collapsed by default).
 */

import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, Copy, Plug, X } from 'lucide-react';

import type { ProcessView } from '@/lib/bundle-view';
import type { Flag } from '@/types/ir';
import type { TestCase } from '@/types/sop';

/** Props for {@link ProcessDetail}. */
export interface ProcessDetailProps {
  /** The process to show, or `null` to keep the panel closed. */
  process: ProcessView | null;
  /** Close handler. */
  onClose: () => void;
}

const ROLE_LABEL: Record<ProcessView['role'], string> = {
  root: 'Entry point',
  leaf: 'Utility (leaf)',
  intermediate: 'Intermediate',
};

export function ProcessDetail({
  process,
  onClose,
}: ProcessDetailProps): React.JSX.Element {
  const open = process !== null;

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={[
        'fixed inset-0 z-40 transition',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      ].join(' ')}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={[
          'absolute inset-0 bg-neutral-900/30 transition-opacity',
          open ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      />

      {/* Panel */}
      <aside
        className={[
          'absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
      >
        {process && <DetailBody process={process} onClose={onClose} />}
      </aside>
    </div>
  );
}

function DetailBody({
  process,
  onClose,
}: {
  process: ProcessView;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {ROLE_LABEL[process.role]}
            </span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
              {process.stage}
            </span>
          </div>
          <h2 className="mt-2 truncate text-xl font-semibold text-neutral-900">
            {process.name}
          </h2>
          <p className="mt-1 font-mono text-xs text-neutral-400">{process.id}</p>
          <p className="mt-1 text-sm text-neutral-500">
            {process.lineCount} lines
            {process.owner ? ` \u00b7 ${process.owner}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
        {process.failed && !process.sop && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            This process couldn&rsquo;t be fully analyzed or generated. Some
            sections below may be empty.
          </p>
        )}

        <SopSection sop={process.sop?.sop} />
        {process.sop && <TestPlanSection testCases={process.sop.testPlan.testCases} prerequisites={process.sop.testPlan.prerequisites} />}
        {process.sop && (
          <ConnectionSection requirements={process.sop.connectionRequirements} />
        )}
        <FlagsSection flags={process.flags} />
        <SourceSection source={process.source} />
      </div>
    </>
  );
}

function Section({
  title,
  children,
  trailing,
}: {
  title: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </h3>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function SopSection({ sop }: { sop?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    if (!sop) return;
    try {
      await navigator.clipboard.writeText(sop);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable (insecure context); ignore silently.
    }
  };

  return (
    <Section
      title="SOP"
      trailing={
        sop ? (
          <button
            type="button"
            onClick={copy}
            className={[
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              copied
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700',
            ].join(' ')}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy SOP'}
          </button>
        ) : undefined
      }
    >
      {sop ? (
        <div className="prose prose-sm prose-neutral max-w-none rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4 prose-headings:font-semibold prose-pre:bg-neutral-900 prose-code:font-mono prose-code:text-[13px]">
          <Markdown remarkPlugins={[remarkGfm]}>{sop}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-neutral-400">No SOP generated for this process.</p>
      )}
    </Section>
  );
}

const CATEGORY_STYLE: Record<TestCase['category'], string> = {
  happy_path: 'bg-green-50 text-green-700',
  edge_case: 'bg-yellow-50 text-yellow-700',
  error_case: 'bg-red-50 text-red-700',
  integration: 'bg-blue-50 text-blue-700',
};

function TestPlanSection({
  testCases,
  prerequisites,
}: {
  testCases: TestCase[];
  prerequisites: string[];
}): React.JSX.Element {
  return (
    <Section title={`Test plan \u00b7 ${testCases.length} case${testCases.length === 1 ? '' : 's'}`}>
      {prerequisites.length > 0 && (
        <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="text-xs font-semibold text-neutral-500">Prerequisites</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-600">
            {prerequisites.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="space-y-2">
        {testCases.map((tc) => (
          <li key={tc.id}>
            <details className="group rounded-lg border border-neutral-200">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5">
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-neutral-400 transition group-open:rotate-180" />
                <span
                  className={[
                    'rounded px-1.5 py-0.5 text-[11px] font-medium',
                    CATEGORY_STYLE[tc.category],
                  ].join(' ')}
                >
                  {tc.category.replace('_', ' ')}
                </span>
                <span className="truncate text-sm font-medium text-neutral-800">{tc.name}</span>
                <span className="ml-auto text-[11px] uppercase text-neutral-400">{tc.priority}</span>
              </summary>
              <div className="space-y-2 border-t border-neutral-100 px-4 py-3 text-sm text-neutral-600">
                <p>{tc.description}</p>
                {Object.keys(tc.inputs).length > 0 && (
                  <KeyValues label="Inputs" entries={tc.inputs} render={(v) => stringifyInput(v)} />
                )}
                {tc.expectedBehavior.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-neutral-500">Expected behavior</p>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                      {tc.expectedBehavior.map((b, i) => (
                        <li key={i}>{b.description}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function KeyValues<T>({
  label,
  entries,
  render,
}: {
  label: string;
  entries: Record<string, T>;
  render: (value: T) => string;
}): React.JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold text-neutral-500">{label}</p>
      <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {Object.entries(entries).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-xs text-neutral-500">{k}</dt>
            <dd className="truncate font-mono text-xs text-neutral-700">{render(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function stringifyInput(input: { value?: unknown }): string {
  const v = input.value;
  if (v === undefined || v === null) return '\u2014';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ConnectionSection({
  requirements,
}: {
  requirements: { integration: string; reason: string; isCustomActionsIntegration: boolean }[];
}): React.JSX.Element {
  return (
    <Section title={`Connections \u00b7 ${requirements.length}`}>
      {requirements.length === 0 ? (
        <p className="text-sm text-neutral-400">No external connections required.</p>
      ) : (
        <ul className="space-y-2">
          {requirements.map((req) => (
            <li
              key={req.integration}
              className="flex items-start gap-3 rounded-lg border border-neutral-200 px-4 py-3"
            >
              <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-blue-50 text-blue-600">
                <Plug className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-neutral-800">
                  {req.integration}
                  {req.isCustomActionsIntegration && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                      Custom Actions
                    </span>
                  )}
                </p>
                <p className="text-sm text-neutral-500">{req.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const FLAG_STYLE: Record<Flag['severity'], string> = {
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
};

function FlagsSection({ flags }: { flags: Flag[] }): React.JSX.Element {
  return (
    <Section title={`Flags \u00b7 ${flags.length}`}>
      {flags.length === 0 ? (
        <p className="text-sm text-neutral-400">No migration flags. Clean port.</p>
      ) : (
        <ul className="space-y-2">
          {flags.map((flag, i) => (
            <li
              key={i}
              className={['rounded-lg border px-4 py-2.5', FLAG_STYLE[flag.severity]].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{flag.code}</span>
                {flag.line !== undefined && (
                  <span className="text-[11px] opacity-70">line {flag.line}</span>
                )}
              </div>
              <p className="mt-0.5 text-sm">{flag.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SourceSection({ source }: { source: string }): React.JSX.Element {
  return (
    <Section title="Original v1 source">
      <details className="group rounded-lg border border-neutral-200">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-neutral-600">
          <ChevronDown className="h-4 w-4 text-neutral-400 transition group-open:rotate-180" />
          View source
        </summary>
        <pre className="max-h-96 overflow-auto border-t border-neutral-100 bg-neutral-900 px-4 py-3 font-mono text-xs leading-relaxed text-neutral-100">
          {source}
        </pre>
      </details>
    </Section>
  );
}
