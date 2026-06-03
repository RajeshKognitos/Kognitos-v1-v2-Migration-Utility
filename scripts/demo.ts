/**
 * End-to-end Phase 1 + Phase 3 demo: HAR → bundle → analyzed IRs → SOPs +
 * test plans (real OpenAI). Prints a per-process analyzer summary and a second
 * SOP summary, then writes:
 *   - /tmp/analyzed-bundle.json      full AnalyzedBundle (Phase 1)
 *   - /tmp/sops/{name}.md            one consolidated SOP per process group (Phase 3)
 *   - /tmp/sops/{name}.testplan.json one end-to-end test plan per group (Phase 3)
 *   - /tmp/sop-bundle.json           full BundleSopResult (Phase 3)
 *   - /tmp/connection-checklist.json deduplicated v2 Connection requirements
 * Run: OPENAI_API_KEY=sk-... npx tsx scripts/demo.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractAgentBundleFromHar } from '../src/lib/har';
import { analyzeBundle } from '../src/lib/analyzer/orchestrator';
import { generateBundleSops } from '../src/lib/sop';
import type { StatementIR, V1ProcessIR } from '../src/types/ir';

const ansi = (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const c = { dim: ansi(2), bold: ansi(1), cyan: ansi(36), green: ansi(32), red: ansi(31) };

const FIXTURE = fileURLToPath(
  new URL('../samples/agent-bundles/01-vendor-helpdesk.har', import.meta.url),
);
const OUT = '/tmp/analyzed-bundle.json';
const SOP_DIR = '/tmp/sops';
const SOP_BUNDLE_OUT = '/tmp/sop-bundle.json';
const CONNECTIONS_OUT = '/tmp/connection-checklist.json';

/** Slugify a process name into a filesystem-safe stem. */
const sanitize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

/** Flatten a statement tree, descending into conditionals and loops. */
function flatten(statements: StatementIR[]): StatementIR[] {
  return statements.flatMap((s) => {
    if (s.kind === 'conditional') return [s, ...flatten(s.thenBranch), ...flatten(s.elseBranch ?? [])];
    if (s.kind === 'loop') return [s, ...flatten(s.body)];
    return [s];
  });
}
const statementsOf = (ir: V1ProcessIR): StatementIR[] =>
  ir.procedures.flatMap((p) => flatten(p.statements));
const flagCount = (ir: V1ProcessIR): number =>
  ir.flags.length + ir.procedures.reduce((n, p) => n + p.flags.length, 0);
const pad = (s: string, w: number): string =>
  s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w);
/** JSON replacer that serializes Maps as plain objects. */
const replacer = (_k: string, v: unknown): unknown =>
  v instanceof Map ? Object.fromEntries(v) : v;

async function main(): Promise<void> {
  // Load .env.local (e.g. OPENAI_API_KEY) like the test harness does; inline
  // env vars win since loadEnvFile never overwrites already-set keys.
  const envPath = fileURLToPath(new URL('../.env.local', import.meta.url));
  const load = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (load && existsSync(envPath)) load(envPath);

  if (!process.env.OPENAI_API_KEY) {
    console.error(c.red('OPENAI_API_KEY is not set.'));
    process.exit(1);
  }

  console.log(c.dim(`Reading ${FIXTURE}`));
  const har = readFileSync(FIXTURE, 'utf8');
  const bundle = await extractAgentBundleFromHar(har, {
    filename: '01-vendor-helpdesk.har',
  });
  console.log(c.dim(`Extracted ${bundle.processes.length} processes. Analyzing…\n`));

  const result = await analyzeBundle(bundle);

  const header = `${pad('Process', 40)} ${pad('Lines', 6)} ${pad('Books', 28)} ${pad('Subs', 5)} ${pad('Flags', 5)}`;
  console.log(c.bold(header));
  console.log(c.dim('-'.repeat(header.length)));

  for (const proc of bundle.processes) {
    const ir = result.irs.get(proc.id);
    if (!ir) {
      console.log(`${pad(proc.name, 40)} ${c.red('(failed to analyze)')}`);
      continue;
    }
    const stmts = statementsOf(ir);
    const books = [
      ...new Set(
        stmts.filter((s) => s.kind === 'book_usage').map((s) => s.bookName),
      ),
    ].join(', ');
    const subs = stmts.filter((s) => s.kind === 'subprocess_call').length;
    console.log(
      `${c.cyan(pad(proc.name, 40))} ${pad(String(proc.lineCount), 6)} ${pad(books, 28)} ${pad(String(subs), 5)} ${pad(String(flagCount(ir)), 5)}`,
    );
  }

  writeFileSync(OUT, JSON.stringify(result, replacer, 2), 'utf8');
  console.log(c.dim(`\nFull AnalyzedBundle → ${OUT}`));

  // ── Phase 3: consolidated SOP + test-plan generation (one per group) ──────
  console.log(c.dim('\nGenerating consolidated business SOPs + test plans…\n'));
  const ownersById = new Map(bundle.processes.map((p) => [p.id, p.owner]));
  const sopResult = await generateBundleSops(result, { ownersById });

  mkdirSync(SOP_DIR, { recursive: true });

  const sopHeader = `${pad('Business process', 40)} ${pad('Members', 8)} ${pad('SOP chars', 10)} ${pad('Tests', 6)} ${pad('Conns', 6)}`;
  console.log(c.bold(sopHeader));
  console.log(c.dim('-'.repeat(sopHeader.length)));

  for (const group of sopResult.groups) {
    const stem = sanitize(group.entryProcedureName);
    writeFileSync(`${SOP_DIR}/${stem}.md`, group.sop, 'utf8');
    writeFileSync(
      `${SOP_DIR}/${stem}.testplan.json`,
      JSON.stringify(group.testPlan, null, 2),
      'utf8',
    );
    console.log(
      `${c.cyan(pad(group.entryProcedureName, 40))} ${pad(String(group.memberProcedureIds.length), 8)} ${pad(String(group.sop.length), 10)} ${pad(String(group.testPlan.testCases.length), 6)} ${pad(String(group.connectionRequirements.length), 6)}`,
    );
  }

  writeFileSync(SOP_BUNDLE_OUT, JSON.stringify(sopResult, replacer, 2), 'utf8');
  writeFileSync(
    CONNECTIONS_OUT,
    JSON.stringify(sopResult.aggregatedConnections, null, 2),
    'utf8',
  );

  console.log(c.dim(`\nSOPs + test plans → ${SOP_DIR}/`));
  console.log(c.dim(`Full BundleSopResult → ${SOP_BUNDLE_OUT}`));
  console.log(
    c.dim(
      `Connection checklist → ${CONNECTIONS_OUT} (${sopResult.aggregatedConnections.length} integration(s))`,
    ),
  );

  // ── Combined final summary (analyze + SOP) ───────────────────────────────
  const totalCost = result.tokenUsage.totalCostUsd + sopResult.tokenUsage.totalCostUsd;
  const totalTimeS = (result.timings.totalMs + sopResult.timings.totalMs) / 1000;
  const totalErrors = result.errors.length + sopResult.errors.length;
  console.log(
    `\n${c.bold('Total cost:')} ${c.green(`$${totalCost.toFixed(4)}`)}  ` +
      `${c.bold('Total time:')} ${c.green(`${totalTimeS.toFixed(1)}s`)}  ` +
      `${c.bold('Errors:')} ${totalErrors === 0 ? c.green('0') : c.red(String(totalErrors))}`,
  );
  for (const e of result.errors) {
    console.log(c.red(`  ✗ [analyze] ${e.procedureName} (${e.procedureId}): ${e.error}`));
  }
  for (const e of sopResult.errors) {
    console.log(c.red(`  ✗ [sop] ${e.entryName} (${e.groupId}): ${e.error}`));
  }
}

main().catch((err) => {
  console.error(c.red(err instanceof Error ? err.stack ?? err.message : String(err)));
  process.exit(1);
});
