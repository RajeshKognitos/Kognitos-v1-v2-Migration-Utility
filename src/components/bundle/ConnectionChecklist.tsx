'use client';

/**
 * Aggregated connection checklist (Phase 3.5, FILE 10).
 *
 * One row per distinct v2 Integration required across the whole bundle, showing
 * how many processes use it and a "Custom Actions" badge where the integration's
 * actions must be discovered in-product (SAP, NetSuite, Salesforce, ...). Each
 * row links out to Kognitos v2 (the user picks their Workspace there).
 */

import { ExternalLink, Plug } from 'lucide-react';

import { connectionUsageCounts } from '@/lib/bundle-view';
import type { MigrationResult } from '@/lib/sse-client';

/** Where "Open in Kognitos v2" points (user selects their Workspace there). */
const KOGNITOS_V2_URL = 'https://app.us-1.kognitos.com';

/** Props for {@link ConnectionChecklist}. */
export interface ConnectionChecklistProps {
  result: MigrationResult;
}

export function ConnectionChecklist({
  result,
}: ConnectionChecklistProps): React.JSX.Element {
  const connections = result.sop.aggregatedConnections;
  const usage = connectionUsageCounts(result);

  if (connections.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
        No external connections required across this bundle.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
        <div>
          <h3 className="font-semibold text-neutral-900">Connection checklist</h3>
          <p className="text-sm text-neutral-500">
            {connections.length} integration{connections.length === 1 ? '' : 's'} to set
            up before migrating
          </p>
        </div>
        <a
          href={KOGNITOS_V2_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Open Kognitos v2
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <ul className="divide-y divide-neutral-100">
        {connections.map((conn) => {
          const count = usage.get(conn.integration.trim().toLowerCase()) ?? 1;
          return (
            <li
              key={conn.integration}
              className="flex items-start gap-4 px-5 py-4 transition hover:bg-neutral-50"
            >
              <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Plug className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-neutral-900">{conn.integration}</p>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                    {count} business process{count === 1 ? '' : 'es'}
                  </span>
                  {conn.isCustomActionsIntegration && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      needs Custom Actions
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-neutral-500">{conn.reason}</p>
              </div>
              <a
                href={conn.setupUrl ?? KOGNITOS_V2_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-blue-600 transition hover:text-blue-700"
              >
                Set up
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
