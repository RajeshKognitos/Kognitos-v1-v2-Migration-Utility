'use client';

/**
 * Process detail slide-out panel (Phase 3.5, FILE 9).
 *
 * Right-side drawer (full-screen sheet on mobile) for one {@link ProcessView}:
 * header, the rendered SOP markdown with a one-tap "Copy SOP" button, the test
 * plan, this process's connection requirements, its flags, and the original v1
 * source (collapsed by default).
 */

import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  Copy,
  HelpCircle,
  Plug,
  Plug2,
  Send,
  Timer,
  X,
} from 'lucide-react';

import type { ProcessView } from '@/lib/bundle-view';
import type { Flag, StatementIR, TriggerIR, V1ProcessIR } from '@/types/ir';
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
  const panelRef = useRef<HTMLElement>(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus into the panel when it opens (so Esc/Tab work as expected).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

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
        ref={panelRef}
        tabIndex={-1}
        className={[
          'absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl outline-none transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={process ? `Details for ${process.name}` : undefined}
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
        {process.failed && !process.group && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            This process couldn&rsquo;t be fully analyzed or generated. Some
            sections below may be empty.
          </p>
        )}

        {process.group && process.group.kind === 'consolidated' && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {process.isGroupEntry ? (
              <>
                Entry point of the business process{' '}
                <span className="font-semibold">{process.group.entryProcedureName}</span>.
                This page shows what this specific step does; the full end-to-end
                document is under{' '}
                <span className="font-medium">Business-process documents</span> below.
              </>
            ) : (
              <>
                Sub-task of the business process{' '}
                <span className="font-semibold">{process.group.entryProcedureName}</span>.
                Below is what this specific step does; the consolidated SOP it
                belongs to is shared under{' '}
                <span className="font-medium">Business-process documents</span>.
              </>
            )}
          </p>
        )}

        <ProcessSummary ir={process.ir} />

        <FlagsSection flags={process.flags} />

        {process.group && (
          <SharedBusinessDocs group={process.group} defaultOpen={process.isGroupEntry} />
        )}

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

/** A labeled `<details>` disclosure used for the shared business docs. */
function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="group rounded-xl border border-neutral-200" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-neutral-700">
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-neutral-400 transition group-open:rotate-180" />
        {title}
      </summary>
      <div className="border-t border-neutral-100 px-4 py-4">{children}</div>
    </details>
  );
}

/** Flatten a statement tree (descending into conditionals/loops). */
function flattenStatements(statements: StatementIR[]): StatementIR[] {
  return statements.flatMap((s) => {
    if (s.kind === 'conditional') {
      return [s, ...flattenStatements(s.thenBranch), ...flattenStatements(s.elseBranch ?? [])];
    }
    if (s.kind === 'loop') return [s, ...flattenStatements(s.body)];
    return [s];
  });
}

function triggerLabel(t: TriggerIR): string {
  if (t.kind === 'schedule') return `Schedule (${t.interval})`;
  if (t.kind === 'email') return t.emailAddress ? `Email (${t.emailAddress})` : 'Email trigger';
  return t.endpoint ? `API (${t.endpoint})` : 'API trigger';
}

/**
 * Per-process structural summary derived from the IR — the part that is UNIQUE
 * to this process (triggers, inputs, integrations it uses, sub-tasks it calls,
 * and the human checkpoints / decisions it raises). This is what differentiates
 * one node in the hierarchy from another.
 */
function ProcessSummary({ ir }: { ir?: V1ProcessIR }): React.JSX.Element {
  if (!ir) {
    return (
      <Section title="What this step does">
        <p className="text-sm text-neutral-400">
          No analyzed detail is available for this process.
        </p>
      </Section>
    );
  }

  const stmts = flattenStatements(ir.procedures.flatMap((p) => p.statements));
  const triggers = ir.procedures.flatMap((p) => p.triggers);
  const inputs = ir.procedures.flatMap((p) => p.inputs);

  const calls = stmts.filter((s): s is Extract<StatementIR, { kind: 'subprocess_call' }> =>
    s.kind === 'subprocess_call',
  );
  const books = stmts.filter((s): s is Extract<StatementIR, { kind: 'book_usage' }> =>
    s.kind === 'book_usage',
  );
  const checkpoints = stmts.filter((s): s is Extract<StatementIR, { kind: 'exception' }> =>
    s.kind === 'exception',
  );
  const actionVerbs = [
    ...new Set(
      stmts
        .filter((s): s is Extract<StatementIR, { kind: 'procedure_call' }> => s.kind === 'procedure_call')
        .map((s) => s.verb),
    ),
  ];

  // Distinct book+action pairs.
  const integrations = [
    ...new Map(books.map((b) => [`${b.bookName}|${b.action}`, b])).values(),
  ];

  const empty =
    triggers.length === 0 &&
    inputs.length === 0 &&
    calls.length === 0 &&
    integrations.length === 0 &&
    checkpoints.length === 0 &&
    actionVerbs.length === 0;

  return (
    <Section title="What this step does">
      {empty ? (
        <p className="text-sm text-neutral-400">
          This process has no extracted operations.
        </p>
      ) : (
        <div className="space-y-4">
          {triggers.length > 0 && (
            <SummaryBlock icon={<Timer className="h-3.5 w-3.5" />} label="Triggers">
              <ChipRow items={triggers.map(triggerLabel)} />
            </SummaryBlock>
          )}

          {inputs.length > 0 && (
            <SummaryBlock icon={<ArrowRightLeft className="h-3.5 w-3.5" />} label="Inputs">
              <ul className="space-y-1 text-sm text-neutral-700">
                {inputs.map((inp, i) => (
                  <li key={`${inp.name}-${i}`} className="flex items-center gap-2">
                    <span className="font-medium">{inp.name}</span>
                    <span className="text-xs text-neutral-400">
                      {inp.required ? 'required' : 'optional'}
                      {inp.type ? ` \u00b7 ${inp.type}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </SummaryBlock>
          )}

          {integrations.length > 0 && (
            <SummaryBlock icon={<Plug2 className="h-3.5 w-3.5" />} label="Integrations used">
              <ul className="space-y-1 text-sm text-neutral-700">
                {integrations.map((b, i) => (
                  <li key={`${b.bookName}-${i}`}>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                      {b.bookName}
                    </span>{' '}
                    <span className="text-neutral-600">{b.action}</span>
                  </li>
                ))}
              </ul>
            </SummaryBlock>
          )}

          {calls.length > 0 && (
            <SummaryBlock icon={<Send className="h-3.5 w-3.5" />} label="Calls these sub-tasks">
              <ul className="space-y-1 text-sm text-neutral-700">
                {calls.map((c, i) => (
                  <li key={`${c.processName}-${i}`} className="flex items-center gap-2">
                    <span className="font-medium">{c.processName}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-500">
                      {c.mechanism.replace('_', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </SummaryBlock>
          )}

          {checkpoints.length > 0 && (
            <SummaryBlock icon={<HelpCircle className="h-3.5 w-3.5" />} label="Human checkpoints">
              <ul className="space-y-1 text-sm text-neutral-700">
                {checkpoints.map((c, i) => (
                  <li key={`${c.type}-${i}`} className="flex items-start gap-2">
                    <span className="mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                      {c.type}
                    </span>
                    <span className="min-w-0">
                      <span className="text-neutral-700">{c.expression}</span>
                      <span className="ml-1 text-xs text-neutral-400">
                        ({c.pausesOnMissing ? 'pauses for a human' : 'continues if missing'})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </SummaryBlock>
          )}

          {actionVerbs.length > 0 && (
            <SummaryBlock icon={<ArrowRightLeft className="h-3.5 w-3.5" />} label="Key actions">
              <ChipRow items={actionVerbs} />
            </SummaryBlock>
          )}
        </div>
      )}
    </Section>
  );
}

function SummaryBlock({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <span className="text-neutral-400">{icon}</span>
        {label}
      </p>
      {children}
    </div>
  );
}

function ChipRow({ items }: { items: string[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * The group-level documents (consolidated SOP, end-to-end test plan, and
 * connection requirements). These are SHARED across every process in the group,
 * so they live in collapsible disclosures (the SOP opens by default for the
 * group's entry point).
 */
function SharedBusinessDocs({
  group,
  defaultOpen,
}: {
  group: NonNullable<ProcessView['group']>;
  defaultOpen: boolean;
}): React.JSX.Element {
  return (
    <Section title="Business-process documents (shared)">
      <p className="mb-3 text-xs text-neutral-400">
        Shared across all {group.memberProcedureIds.length} process
        {group.memberProcedureIds.length === 1 ? '' : 'es'} in &ldquo;
        {group.entryProcedureName}&rdquo;.
      </p>
      <div className="space-y-3">
        <Collapsible title="Consolidated SOP" defaultOpen={defaultOpen}>
          <SopBody sop={group.sop} />
        </Collapsible>
        <Collapsible title={`End-to-end test plan \u00b7 ${group.testPlan.testCases.length} cases`}>
          <TestPlanBody
            testCases={group.testPlan.testCases}
            prerequisites={group.testPlan.prerequisites}
          />
        </Collapsible>
        <Collapsible title={`Connections \u00b7 ${group.connectionRequirements.length}`}>
          <ConnectionBody requirements={group.connectionRequirements} />
        </Collapsible>
      </div>
    </Section>
  );
}

function SopBody({ sop }: { sop: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sop);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable (insecure context); ignore silently.
    }
  };
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={copy}
          className={[
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
            copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700',
          ].join(' ')}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy SOP'}
        </button>
      </div>
      <div className="prose prose-sm prose-neutral max-w-none prose-headings:font-semibold prose-pre:bg-neutral-900 prose-code:font-mono prose-code:text-[13px]">
        <Markdown remarkPlugins={[remarkGfm]}>{sop}</Markdown>
      </div>
    </div>
  );
}

const CATEGORY_STYLE: Record<TestCase['category'], string> = {
  happy_path: 'bg-green-50 text-green-700',
  edge_case: 'bg-yellow-50 text-yellow-700',
  error_case: 'bg-red-50 text-red-700',
  integration: 'bg-blue-50 text-blue-700',
};

function TestPlanBody({
  testCases,
  prerequisites,
}: {
  testCases: TestCase[];
  prerequisites: string[];
}): React.JSX.Element {
  return (
    <>
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
    </>
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

function ConnectionBody({
  requirements,
}: {
  requirements: { integration: string; reason: string; isCustomActionsIntegration: boolean }[];
}): React.JSX.Element {
  return (
    <>
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
    </>
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
