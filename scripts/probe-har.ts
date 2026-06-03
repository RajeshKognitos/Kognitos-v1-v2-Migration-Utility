/**
 * Throwaway probe: report what data the sample HAR(s) actually contain.
 * Run: npx tsx scripts/probe-har.ts
 */
import { readFileSync } from 'node:fs';
import { extractAgentBundleFromHar, sanitizeHar } from '../src/lib/har';

const FILE = process.argv[2] ?? 'samples/agent-bundles/01-vendor-helpdesk.har';

function keysOf(v: unknown): string[] {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as object) : [];
}

async function main(): Promise<void> {
  const raw = readFileSync(FILE, 'utf8');

  // --- Raw GraphQL operation census + procedure field census ---
  const har = JSON.parse(raw) as { log: { entries: unknown[] } };
  const opCounts = new Map<string, number>();
  const procKeys = new Set<string>();
  const runKeys = new Set<string>();
  let sampleProc: Record<string, unknown> | null = null;

  for (const entry of har.log.entries) {
    const e = entry as {
      request?: { url?: string; postData?: { text?: string } };
      response?: { content?: { text?: string } };
    };
    if (!e.request?.url || !/graphql/i.test(e.request.url)) continue;
    const reqText = e.request.postData?.text;
    const resText = e.response?.content?.text;
    if (typeof reqText !== 'string' || typeof resText !== 'string') continue;
    let req: unknown;
    let res: unknown;
    try {
      req = JSON.parse(reqText);
      res = JSON.parse(resText);
    } catch {
      continue;
    }
    const reqs = Array.isArray(req) ? req : [req];
    const ress = Array.isArray(res) ? res : [res];
    for (let i = 0; i < reqs.length; i += 1) {
      const op = (reqs[i] as { operationName?: string })?.operationName;
      if (!op) continue;
      opCounts.set(op, (opCounts.get(op) ?? 0) + 1);
      if (op === 'procedureGroup') {
        const data = (ress[i] as { data?: { procedureGroup?: Record<string, unknown> } })?.data;
        const pg = data?.procedureGroup;
        const proc =
          (pg?.publishedProcedure as Record<string, unknown>) ??
          (pg?.draftProcedure as Record<string, unknown>);
        if (proc) {
          for (const k of keysOf(proc)) procKeys.add(k);
          for (const k of keysOf(proc.latestRunData)) runKeys.add(k);
          if (!sampleProc) sampleProc = proc;
        }
      }
    }
  }

  console.log('=== GraphQL operations seen (name × count) ===');
  for (const [op, n] of [...opCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${op}: ${n}`);
  }
  console.log('\n=== Raw procedure object keys (procedureGroup) ===');
  console.log('  ' + [...procKeys].sort().join(', '));
  console.log('\n=== latestRunData keys ===');
  console.log('  ' + ([...runKeys].sort().join(', ') || '(none present)'));

  // --- Sanitizer effect ---
  const { har: sanitized } = sanitizeHar(har as never);
  console.log(`\n=== Sanitizer ===`);
  console.log(`  entries before: ${har.log.entries.length}, after: ${sanitized.log.entries.length}`);

  // --- Extracted bundle field availability ---
  const bundle = await extractAgentBundleFromHar(raw, { filename: FILE });
  console.log('\n=== Extracted bundle ===');
  console.log(`  departmentId: ${bundle.sourceMeta.departmentId ?? '(none)'}`);
  console.log(`  processes: ${bundle.processes.length}`);
  console.log(`  detectedBooks: ${bundle.detectedBooks.join(', ') || '(none)'}`);
  console.log(
    `  callGraph: ${bundle.callGraph.nodes.length} nodes, ${bundle.callGraph.edges.length} edges, ` +
      `${bundle.callGraph.roots.length} roots, ${bundle.callGraph.leaves.length} leaves, ` +
      `${bundle.callGraph.cycles.length} cycles`,
  );

  const withOwner = bundle.processes.filter((p) => p.owner).length;
  const published = bundle.processes.filter((p) => p.stage === 'PUBLISHED').length;
  const withSchedules = bundle.processes.filter((p) => p.schedules.length > 0).length;
  const withRun = bundle.processes.filter((p) => p.latestRunData).length;
  const withVersion = bundle.processes.filter((p) => p.version).length;
  const totalRefs = bundle.processes.reduce((n, p) => n + p.subprocessRefs.length, 0);
  const unresolvedRefs = bundle.processes.reduce(
    (n, p) => n + p.subprocessRefs.filter((r) => !r.resolvableInBundle).length,
    0,
  );

  console.log('\n=== Per-process field availability (n / total) ===');
  const t = bundle.processes.length;
  console.log(`  owner (email):     ${withOwner}/${t}`);
  console.log(`  version:           ${withVersion}/${t}`);
  console.log(`  stage=PUBLISHED:   ${published}/${t}`);
  console.log(`  schedules:         ${withSchedules}/${t}`);
  console.log(`  latestRunData:     ${withRun}/${t}`);
  console.log(`  subprocessRefs:    ${totalRefs} total (${unresolvedRefs} unresolved)`);

  console.log('\n=== Warnings by code ===');
  const wc = new Map<string, number>();
  for (const w of bundle.warnings) wc.set(w.code, (wc.get(w.code) ?? 0) + 1);
  for (const [code, n] of wc) console.log(`  ${code}: ${n}`);

  console.log('\n=== Process list ===');
  for (const p of bundle.processes) {
    console.log(
      `  - ${p.name} [${p.stage}] lines=${p.lineCount} refs=${p.subprocessRefs.length}` +
        ` owner=${p.owner ? 'yes' : 'no'} sched=${p.schedules.length} run=${p.latestRunData ? 'yes' : 'no'}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
