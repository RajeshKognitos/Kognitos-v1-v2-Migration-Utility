'use client';

/**
 * Business Processes view (Phase 3.5+).
 *
 * One card per process group (a connected set of parent-child processes),
 * selected via a horizontal pill bar. Each card is itself a sub-tabbed workspace
 * for that ONE business process: Consolidated SOP, Hierarchy, Call Graph (scoped
 * to the group), Test plan, Connections, and Risks (aggregated migration flags).
 * Singletons (disconnected processes) render as a single-node business process.
 */

import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitFork,
  Info,
  ListChecks,
  Network,
  Plug,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

import { CallGraphView } from '@/components/bundle/CallGraphView';
import { HierarchyTree } from '@/components/bundle/HierarchyTree';
import type { GroupView, ProcessView } from '@/lib/bundle-view';
import type { CallGraph } from '@/lib/har';
import type { Flag } from '@/types/ir';
import type { TestCase } from '@/types/sop';

/** Props for {@link ProcessGroupsView}. */
export interface ProcessGroupsViewProps {
  groups: GroupView[];
  processes: ProcessView[];
  callGraph: CallGraph;
  onSelect: (process: ProcessView) => void;
}

/** A migration flag paired with the process it came from. */
interface AttributedFlag {
  flag: Flag;
  processName: string;
}

/** Aggregate every member process's flags, attributed and severity-sorted. */
function aggregateFlags(group: GroupView): {
  items: AttributedFlag[];
  errors: number;
  warnings: number;
  infos: number;
} {
  const rank: Record<Flag['severity'], number> = { error: 0, warning: 1, info: 2 };
  const items: AttributedFlag[] = group.members
    .flatMap((m) => m.flags.map((flag) => ({ flag, processName: m.name })))
    .sort((a, b) => rank[a.flag.severity] - rank[b.flag.severity]);
  return {
    items,
    errors: items.filter((i) => i.flag.severity === 'error').length,
    warnings: items.filter((i) => i.flag.severity === 'warning').length,
    infos: items.filter((i) => i.flag.severity === 'info').length,
  };
}

export function ProcessGroupsView({
  groups,
  processes,
  callGraph,
  onSelect,
}: ProcessGroupsViewProps): React.JSX.Element {
  const processesById = useMemo(
    () => new Map(processes.map((p) => [p.id, p])),
    [processes],
  );
  const [activeId, setActiveId] = useState<string>(groups[0]?.groupId ?? '');

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
        No business processes to show.
      </div>
    );
  }

  const active = groups.find((g) => g.groupId === activeId) ?? groups[0];

  return (
    <div className="space-y-5">
      {/* Horizontal business-process selector (scrolls when there are many). */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Business processes">
        {groups.map((group) => {
          const selected = group.groupId === active.groupId;
          const { errors, warnings } = aggregateFlags(group);
          const dotClass = group.failed || errors > 0
            ? 'bg-red-500'
            : warnings > 0
              ? 'bg-amber-500'
              : selected
                ? 'bg-blue-500'
                : 'bg-neutral-300';
          return (
            <button
              key={group.groupId}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(group.groupId)}
              className={[
                'flex flex-shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                selected
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900',
              ].join(' ')}
              title={errors > 0 ? `${errors} error flag(s)` : warnings > 0 ? `${warnings} warning flag(s)` : undefined}
            >
              <span className={['h-1.5 w-1.5 flex-shrink-0 rounded-full', dotClass].join(' ')} />
              <span className="max-w-[14rem] truncate">{group.entryName}</span>
              <span
                className={[
                  'rounded-full px-1.5 text-xs font-semibold',
                  selected ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-500',
                ].join(' ')}
              >
                {group.memberCount}
              </span>
            </button>
          );
        })}
      </div>

      <GroupCard
        key={active.groupId}
        group={active}
        processesById={processesById}
        processes={processes}
        callGraph={callGraph}
        onSelect={onSelect}
      />
    </div>
  );
}

type SubTabKey = 'sop' | 'hierarchy' | 'graph' | 'tests' | 'connections' | 'risks';

function GroupCard({
  group,
  processesById,
  processes,
  callGraph,
  onSelect,
}: {
  group: GroupView;
  processesById: Map<string, ProcessView>;
  processes: ProcessView[];
  callGraph: CallGraph;
  onSelect: (process: ProcessView) => void;
}): React.JSX.Element {
  const [sub, setSub] = useState<SubTabKey>('sop');
  const flags = useMemo(() => aggregateFlags(group), [group]);
  const testCount = group.sop?.testPlan.testCases.length ?? 0;
  const connCount = group.sop?.connectionRequirements.length ?? 0;

  const subTabs: { key: SubTabKey; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { key: 'sop', label: 'SOP', icon: <FileText className="h-4 w-4" /> },
    {
      key: 'hierarchy',
      label: 'Hierarchy',
      icon: <Network className="h-4 w-4" />,
      badge: <SubCount value={group.memberCount} />,
    },
    { key: 'graph', label: 'Call Graph', icon: <GitFork className="h-4 w-4" /> },
    {
      key: 'tests',
      label: 'Test plan',
      icon: <ListChecks className="h-4 w-4" />,
      badge: testCount > 0 ? <SubCount value={testCount} /> : undefined,
    },
    {
      key: 'connections',
      label: 'Connections',
      icon: <Plug className="h-4 w-4" />,
      badge: connCount > 0 ? <SubCount value={connCount} /> : undefined,
    },
    {
      key: 'risks',
      label: 'Risks',
      icon: <ShieldAlert className="h-4 w-4" />,
      badge:
        flags.errors > 0 ? (
          <SubCount value={flags.errors} tone="error" />
        ) : flags.warnings > 0 ? (
          <SubCount value={flags.warnings} tone="warning" />
        ) : undefined,
    },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                'rounded-full px-2 py-0.5 text-xs font-medium',
                group.kind === 'consolidated'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-neutral-100 text-neutral-600',
              ].join(' ')}
            >
              {group.kind === 'consolidated'
                ? 'Consolidated business process'
                : 'Individual process'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
              <Network className="h-3 w-3" />
              {group.memberCount} process{group.memberCount === 1 ? '' : 'es'}
            </span>
            {flags.errors > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                <ShieldAlert className="h-3 w-3" />
                {flags.errors} error{flags.errors === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <h3 className="mt-2 truncate text-lg font-semibold text-neutral-900">
            {group.entryName}
          </h3>
        </div>
        {group.sop && <CopySopButton sop={group.sop.sop} />}
      </header>

      {/* Sub-tab nav. */}
      <div className="border-b border-neutral-200 px-3">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label={`${group.entryName} views`}>
          {subTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              aria-current={sub === t.key ? 'page' : undefined}
              className={[
                'inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
                sub === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800',
              ].join(' ')}
            >
              {t.icon}
              {t.label}
              {t.badge}
            </button>
          ))}
        </nav>
      </div>

      <div className="px-5 py-5">
        {sub === 'sop' && <SopPanel group={group} />}

        {sub === 'hierarchy' && (
          <HierarchyTree forest={group.forest} processesById={processesById} onSelect={onSelect} />
        )}

        {sub === 'graph' && (
          <CallGraphView
            callGraph={callGraph}
            processes={processes}
            groups={[group]}
            scopeGroupId={group.groupId}
            onSelect={onSelect}
          />
        )}

        {sub === 'tests' &&
          (group.sop ? (
            <TestPlanSummary
              testCases={group.sop.testPlan.testCases}
              prerequisites={group.sop.testPlan.prerequisites}
            />
          ) : (
            <EmptyPanel message="No test plan — SOP generation did not complete for this business process." />
          ))}

        {sub === 'connections' &&
          (connCount > 0 ? (
            <Connections requirements={group.sop?.connectionRequirements ?? []} />
          ) : (
            <EmptyPanel message="No external connections required for this business process." />
          ))}

        {sub === 'risks' && <RisksPanel flags={flags} />}
      </div>
    </section>
  );
}

function SopPanel({ group }: { group: GroupView }): React.JSX.Element {
  if (!group.sop) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>{group.error ?? 'SOP generation failed for this business process.'}</span>
      </div>
    );
  }
  return (
    <div className="prose prose-sm prose-neutral max-w-none rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4 prose-headings:font-semibold prose-pre:bg-neutral-900 prose-code:font-mono prose-code:text-[13px]">
      <Markdown remarkPlugins={[remarkGfm]}>{group.sop.sop}</Markdown>
    </div>
  );
}

const RISK_STYLE: Record<Flag['severity'], { box: string; icon: React.ReactNode; label: string }> = {
  error: {
    box: 'border-red-200 bg-red-50 text-red-700',
    icon: <ShieldAlert className="h-4 w-4" />,
    label: 'Error',
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: <AlertTriangle className="h-4 w-4" />,
    label: 'Warning',
  },
  info: {
    box: 'border-blue-200 bg-blue-50 text-blue-700',
    icon: <Info className="h-4 w-4" />,
    label: 'Info',
  },
};

function RisksPanel({
  flags,
}: {
  flags: { items: AttributedFlag[]; errors: number; warnings: number; infos: number };
}): React.JSX.Element {
  if (flags.items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        <ShieldCheck className="h-5 w-5 flex-shrink-0" />
        No migration risks flagged — this business process looks like a clean port.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <RiskStat count={flags.errors} tone="error" label="errors — need a decision or redesign" />
        <RiskStat count={flags.warnings} tone="warning" label="warnings — review recommended" />
        <RiskStat count={flags.infos} tone="info" label="informational" />
      </div>
      <ul className="space-y-2">
        {flags.items.map((item, i) => {
          const s = RISK_STYLE[item.flag.severity];
          return (
            <li key={i} className={['rounded-lg border px-4 py-3', s.box].join(' ')}>
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0">{s.icon}</span>
                <span className="font-mono text-xs font-semibold">{item.flag.code}</span>
                <span className="ml-auto truncate text-[11px] opacity-70">
                  {item.processName}
                  {item.flag.line !== undefined ? ` \u00b7 line ${item.flag.line}` : ''}
                </span>
              </div>
              <p className="mt-1 text-sm">{item.flag.message}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RiskStat({
  count,
  tone,
  label,
}: {
  count: number;
  tone: 'error' | 'warning' | 'info';
  label: string;
}): React.JSX.Element {
  const toneClass =
    tone === 'error'
      ? 'bg-red-100 text-red-700'
      : tone === 'warning'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-blue-100 text-blue-700';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-50 py-1 pl-1 pr-3 text-neutral-500">
      <span className={['rounded-full px-2 py-0.5 font-semibold', toneClass].join(' ')}>{count}</span>
      {label}
    </span>
  );
}

function EmptyPanel({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-400">
      {message}
    </div>
  );
}

function SubCount({
  value,
  tone,
}: {
  value: number;
  tone?: 'error' | 'warning';
}): React.JSX.Element {
  const toneClass =
    tone === 'error'
      ? 'bg-red-100 text-red-700'
      : tone === 'warning'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-neutral-100 text-neutral-500';
  return (
    <span className={['rounded-full px-1.5 text-xs font-semibold', toneClass].join(' ')}>{value}</span>
  );
}

function CopySopButton({ sop }: { sop: string }): React.JSX.Element {
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
    <button
      type="button"
      onClick={copy}
      className={[
        'inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
        copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700',
      ].join(' ')}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy SOP'}
    </button>
  );
}

const CATEGORY_STYLE: Record<TestCase['category'], string> = {
  happy_path: 'bg-green-50 text-green-700',
  edge_case: 'bg-yellow-50 text-yellow-700',
  error_case: 'bg-red-50 text-red-700',
  integration: 'bg-blue-50 text-blue-700',
};

function TestPlanSummary({
  testCases,
  prerequisites,
}: {
  testCases: TestCase[];
  prerequisites: string[];
}): React.JSX.Element {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Test plan &middot; {testCases.length} case{testCases.length === 1 ? '' : 's'}
      </h4>
      {prerequisites.length > 0 && (
        <ul className="mb-2 list-disc space-y-0.5 pl-5 text-xs text-neutral-500">
          {prerequisites.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      <ul className="space-y-1.5">
        {testCases.map((tc) => (
          <li key={tc.id}>
            <details className="group rounded-lg border border-neutral-200">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400 transition group-open:rotate-180" />
                <span
                  className={[
                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                    CATEGORY_STYLE[tc.category],
                  ].join(' ')}
                >
                  {tc.category.replace('_', ' ')}
                </span>
                <span className="truncate text-xs font-medium text-neutral-800">
                  {tc.name}
                </span>
              </summary>
              <p className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-600">
                {tc.description}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Connections({
  requirements,
}: {
  requirements: {
    integration: string;
    reason: string;
    isCustomActionsIntegration: boolean;
  }[];
}): React.JSX.Element {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Connections &middot; {requirements.length}
      </h4>
      <ul className="space-y-1.5">
        {requirements.map((req) => (
          <li
            key={req.integration}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          >
            <Plug className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
            <span className="font-medium text-neutral-800">{req.integration}</span>
            {req.isCustomActionsIntegration && (
              <span className="ml-auto rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Custom Actions
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
