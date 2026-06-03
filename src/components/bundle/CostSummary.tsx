'use client';

/**
 * Cost + timing summary (Phase 3.5, FILE 11).
 *
 * Surfaces the LLM spend and wall-clock time of the run, pulled from
 * `analysis.tokenUsage` / `sop.tokenUsage` and the per-stage `totalMs`. Tokens
 * and dollars are summed across the analyze + SOP stages.
 */

import { Clock, Coins, FileText, Cpu } from 'lucide-react';

import type { MigrationResult } from '@/lib/sse-client';

/** Props for {@link CostSummary}. */
export interface CostSummaryProps {
  result: MigrationResult;
}

const usd = (n: number): string => `$${n.toFixed(4)}`;
const tokens = (n: number): string => n.toLocaleString('en-US');
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export function CostSummary({ result }: CostSummaryProps): React.JSX.Element {
  const { analysis, sop } = result;
  const totalInput = analysis.tokenUsage.totalInput + sop.tokenUsage.totalInput;
  const totalOutput = analysis.tokenUsage.totalOutput + sop.tokenUsage.totalOutput;
  const totalCost = analysis.tokenUsage.totalCostUsd + sop.tokenUsage.totalCostUsd;
  const totalMs = analysis.totalMs + sop.totalMs;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<Coins className="h-5 w-5" />}
          label="Total cost"
          value={usd(totalCost)}
          sub="analyze + SOP"
        />
        <MetricCard
          icon={<Clock className="h-5 w-5" />}
          label="Total time"
          value={seconds(totalMs)}
          sub="wall clock"
        />
        <MetricCard
          icon={<FileText className="h-5 w-5" />}
          label="Input tokens"
          value={tokens(totalInput)}
          sub="prompt"
        />
        <MetricCard
          icon={<Cpu className="h-5 w-5" />}
          label="Output tokens"
          value={tokens(totalOutput)}
          sub="completion"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-5 py-3 font-medium">Stage</th>
              <th className="px-5 py-3 text-right font-medium">Input</th>
              <th className="px-5 py-3 text-right font-medium">Output</th>
              <th className="px-5 py-3 text-right font-medium">Cost</th>
              <th className="px-5 py-3 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            <StageRow
              label="Analyze (Phase 1)"
              input={analysis.tokenUsage.totalInput}
              output={analysis.tokenUsage.totalOutput}
              cost={analysis.tokenUsage.totalCostUsd}
              ms={analysis.totalMs}
            />
            <StageRow
              label="Generate SOPs (Phase 3)"
              input={sop.tokenUsage.totalInput}
              output={sop.tokenUsage.totalOutput}
              cost={sop.tokenUsage.totalCostUsd}
              ms={sop.totalMs}
            />
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-200 bg-neutral-50 font-semibold text-neutral-900">
              <td className="px-5 py-3">Total</td>
              <td className="px-5 py-3 text-right font-mono">{tokens(totalInput)}</td>
              <td className="px-5 py-3 text-right font-mono">{tokens(totalOutput)}</td>
              <td className="px-5 py-3 text-right font-mono">{usd(totalCost)}</td>
              <td className="px-5 py-3 text-right font-mono">{seconds(totalMs)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-neutral-500">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold text-neutral-900">{value}</p>
      <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>
    </div>
  );
}

function StageRow({
  label,
  input,
  output,
  cost,
  ms,
}: {
  label: string;
  input: number;
  output: number;
  cost: number;
  ms: number;
}): React.JSX.Element {
  return (
    <tr className="text-neutral-700">
      <td className="px-5 py-3">{label}</td>
      <td className="px-5 py-3 text-right font-mono">{tokens(input)}</td>
      <td className="px-5 py-3 text-right font-mono">{tokens(output)}</td>
      <td className="px-5 py-3 text-right font-mono">{usd(cost)}</td>
      <td className="px-5 py-3 text-right font-mono">{seconds(ms)}</td>
    </tr>
  );
}
