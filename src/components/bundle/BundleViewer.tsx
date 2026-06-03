'use client';

/**
 * Bundle viewer (Phase 3.5, FILE 6).
 *
 * Tabbed shell for a finished migration: Business Processes | Processes |
 * Connections | Cost (Business Processes is the default). The call graph now
 * lives as a sub-tab inside each business-process card (scoped to that group),
 * so there is no longer a global Call Graph tab. Owns the {@link ProcessView}
 * list and the selected-process state that drives the shared
 * {@link ProcessDetail} panel.
 */

import { useMemo, useState } from 'react';
import { Coins, GitBranch, LayoutGrid, Plug, Workflow } from 'lucide-react';

import { ConnectionChecklist } from '@/components/bundle/ConnectionChecklist';
import { CostSummary } from '@/components/bundle/CostSummary';
import { ProcessDetail } from '@/components/bundle/ProcessDetail';
import { ProcessGroupsView } from '@/components/bundle/ProcessGroupsView';
import { ProcessList } from '@/components/bundle/ProcessList';
import {
  buildGroupViews,
  buildProcessViews,
  type ProcessView,
} from '@/lib/bundle-view';
import type { MigrationResult } from '@/lib/sse-client';

/** Props for {@link BundleViewer}. */
export interface BundleViewerProps {
  result: MigrationResult;
}

type TabKey = 'groups' | 'processes' | 'connections' | 'cost';

interface TabMeta {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

export function BundleViewer({ result }: BundleViewerProps): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('groups');
  const [selected, setSelected] = useState<ProcessView | null>(null);

  const processes = useMemo(() => buildProcessViews(result), [result]);
  const groups = useMemo(() => buildGroupViews(result), [result]);

  const tabs: TabMeta[] = [
    { key: 'groups', label: 'Business Processes', icon: <Workflow className="h-4 w-4" /> },
    { key: 'processes', label: 'Processes', icon: <LayoutGrid className="h-4 w-4" /> },
    { key: 'connections', label: 'Connections', icon: <Plug className="h-4 w-4" /> },
    { key: 'cost', label: 'Cost', icon: <Coins className="h-4 w-4" /> },
  ];

  const totalFlags = processes.reduce((n, p) => n + p.flags.length, 0);

  return (
    <div>
      <SummaryBar
        processCount={result.bundle.processCount}
        rootCount={result.bundle.callGraph.roots.length}
        leafCount={result.bundle.callGraph.leaves.length}
        bookCount={result.bundle.detectedBooks.length}
        connectionCount={result.sop.aggregatedConnections.length}
        flagCount={totalFlags}
      />

      <div className="mt-6 border-b border-neutral-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Bundle views">
          {tabs.map((meta) => (
            <button
              key={meta.key}
              type="button"
              onClick={() => setTab(meta.key)}
              aria-current={tab === meta.key ? 'page' : undefined}
              className={[
                'inline-flex flex-shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition',
                tab === meta.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800',
              ].join(' ')}
            >
              {meta.icon}
              {meta.label}
              {meta.key === 'groups' && <Count value={groups.length} />}
              {meta.key === 'connections' &&
                result.sop.aggregatedConnections.length > 0 && (
                  <Count value={result.sop.aggregatedConnections.length} />
                )}
              {meta.key === 'processes' && <Count value={processes.length} />}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {tab === 'groups' && (
          <ProcessGroupsView
            groups={groups}
            processes={processes}
            callGraph={result.bundle.callGraph}
            onSelect={setSelected}
          />
        )}
        {tab === 'processes' && (
          <ProcessList processes={processes} onSelect={setSelected} />
        )}
        {tab === 'connections' && <ConnectionChecklist result={result} />}
        {tab === 'cost' && <CostSummary result={result} />}
      </div>

      <ProcessDetail process={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Count({ value }: { value: number }): React.JSX.Element {
  return (
    <span className="rounded-full bg-neutral-100 px-1.5 text-xs font-medium text-neutral-500">
      {value}
    </span>
  );
}

function SummaryBar({
  processCount,
  rootCount,
  leafCount,
  bookCount,
  connectionCount,
  flagCount,
}: {
  processCount: number;
  rootCount: number;
  leafCount: number;
  bookCount: number;
  connectionCount: number;
  flagCount: number;
}): React.JSX.Element {
  const items = [
    { label: 'Processes', value: processCount },
    { label: 'Roots', value: rootCount },
    { label: 'Leaves', value: leafCount },
    { label: 'Books', value: bookCount },
    { label: 'Connections', value: connectionCount },
    { label: 'Flags', value: flagCount },
  ];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-600">
        <GitBranch className="h-5 w-5" />
      </span>
      <div>
        <p className="font-semibold text-neutral-900">Agent bundle ready</p>
        <p className="text-sm text-neutral-500">
          {items.map((item, i) => (
            <span key={item.label}>
              {i > 0 && <span className="mx-1.5 text-neutral-300">&middot;</span>}
              <span className="font-medium text-neutral-700">{item.value}</span>{' '}
              {item.label}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
