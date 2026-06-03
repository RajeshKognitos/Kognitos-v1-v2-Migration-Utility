/**
 * Tests for the bundle orchestrator (`analyzeBundle`).
 *
 * Two suites live here:
 *
 *  1. A REAL integration test (gated by RUN_INTEGRATION) that extracts the
 *     vendor-helpdesk bundle and analyzes the whole thing through OpenAI. Run:
 *       RUN_INTEGRATION=1 OPENAI_API_KEY=sk-... npm test -- analyzer/orchestrator
 *
 *  2. Fast unit tests (no API) that mock `analyzeProcess` to verify the
 *     orchestrator's own logic: leaves-first ordering (MR-44), the concurrency
 *     cap, and `resolvableInBundle` resolution.
 *
 * `analyzeProcess` is mocked at the module level with a bare spy. The unit
 * suites install their own fake implementation; the integration suite restores
 * the REAL implementation via `vi.importActual` so it actually hits OpenAI.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

import { extractAgentBundleFromHar } from '@/lib/har';
import type {
  CallGraph,
  ExtractedAgentBundle,
  ExtractedProcess,
} from '@/lib/har';
import { analyzeProcess } from '@/lib/analyzer/client';
import { analyzeBundle } from '@/lib/analyzer/orchestrator';
import type {
  StatementIR,
  SubprocessCallIR,
  V1ProcessIR,
} from '@/types/ir';

// Replace `analyzeProcess` with a spy while keeping the rest of the module
// (AnalyzerError, ANALYZER_VERSION) real.
vi.mock('@/lib/analyzer/client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/analyzer/client')>();
  return { ...actual, analyzeProcess: vi.fn() };
});

const mockedAnalyze = vi.mocked(analyzeProcess);

// ---------------------------------------------------------------------------
// Shared fixtures / helpers
// ---------------------------------------------------------------------------

/** Depth-first flatten of a statement tree (descends conditionals + loops). */
function flattenStatements(statements: StatementIR[]): StatementIR[] {
  const out: StatementIR[] = [];
  for (const stmt of statements) {
    out.push(stmt);
    if (stmt.kind === 'conditional') {
      out.push(...flattenStatements(stmt.thenBranch));
      if (stmt.elseBranch) out.push(...flattenStatements(stmt.elseBranch));
    } else if (stmt.kind === 'loop') {
      out.push(...flattenStatements(stmt.body));
    }
  }
  return out;
}

function subprocessCalls(ir: V1ProcessIR): SubprocessCallIR[] {
  return ir.procedures
    .flatMap((p) => flattenStatements(p.statements))
    .filter((s): s is SubprocessCallIR => s.kind === 'subprocess_call');
}

/** A minimal valid IR (no statements) for unit mocks. */
function emptyIr(): V1ProcessIR {
  return {
    metadata: {
      rawSource: '',
      sourceLineCount: 0,
      parsedAt: '2026-01-01T00:00:00.000Z',
      parserVersion: '1.0.0',
    },
    procedures: [],
    flags: [],
  };
}

/** A bare `subprocess_call` statement pointing at `procedureId`. */
function subprocessCall(procedureId: string, name: string): SubprocessCallIR {
  return {
    kind: 'subprocess_call',
    mechanism: 'run',
    processName: name,
    procedureId,
    parameters: {},
    returnsResult: false,
    line: 1,
    col: 0,
    indent: 0,
    rawText: `run @{${name}}`,
  };
}

function makeProcess(id: string, name: string): ExtractedProcess {
  return {
    id,
    name,
    owner: null,
    stage: 'DRAFT',
    version: '2026-01-01T00:00:00.000Z',
    departmentId: 'dept-1',
    language: 'english',
    // Use the id as the source text so the mock can identify calls by `source`.
    text: id,
    lineCount: 1,
    schedules: [],
    latestRunData: null,
    sourceHash: `hash-${id}`,
    subprocessRefs: [],
  };
}

function makeBundle(
  processes: ExtractedProcess[],
  callGraph: CallGraph,
): ExtractedAgentBundle {
  return {
    sourceMeta: {
      harFilename: 'fake.har',
      extractedAt: '2026-01-01T00:00:00.000Z',
      extractorVersion: '0.5.0',
      departmentId: 'dept-1',
    },
    processes,
    callGraph,
    detectedBooks: [],
    warnings: [],
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Unit tests (no API)
// ---------------------------------------------------------------------------

describe('analyzeBundle — orchestration logic (mocked analyzer)', () => {
  beforeEach(() => {
    mockedAnalyze.mockReset();
  });

  it('analyzes processes leaves-first in topological order (MR-44)', async () => {
    // Chain A → B → C; leaves-first order must be C, B, A.
    const processes = [
      makeProcess('a', 'to do A'),
      makeProcess('b', 'to do B'),
      makeProcess('c', 'to do C'),
    ];
    const callGraph: CallGraph = {
      nodes: processes.map((p) => ({ id: p.id, name: p.name })),
      edges: [
        { from: 'a', to: 'b', callType: 'run' },
        { from: 'b', to: 'c', callType: 'run' },
      ],
      roots: ['a'],
      leaves: ['c'],
      cycles: [],
    };

    const callOrder: string[] = [];
    mockedAnalyze.mockImplementation(async (source: string) => {
      callOrder.push(source);
      return { ir: emptyIr(), tokens: { input: 10, output: 20 } };
    });

    // Concurrency 1 makes ordering strictly deterministic.
    const result = await analyzeBundle(makeBundle(processes, callGraph), {
      concurrency: 1,
    });

    expect(callOrder).toEqual(['c', 'b', 'a']);
    expect(result.irs.size).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('never runs more than the concurrency limit (default 3) in flight', async () => {
    const processes = Array.from({ length: 6 }, (_, i) =>
      makeProcess(`p${i}`, `to do ${i}`),
    );
    const callGraph: CallGraph = {
      nodes: processes.map((p) => ({ id: p.id, name: p.name })),
      edges: [],
      roots: processes.map((p) => p.id),
      leaves: processes.map((p) => p.id),
      cycles: [],
    };

    let inFlight = 0;
    let maxInFlight = 0;
    mockedAnalyze.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(20);
      inFlight -= 1;
      return { ir: emptyIr(), tokens: { input: 1, output: 1 } };
    });

    // Default concurrency (3).
    const result = await analyzeBundle(makeBundle(processes, callGraph));

    expect(result.irs.size).toBe(6);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    // Sanity: parallelism actually happened (otherwise the cap is meaningless).
    expect(maxInFlight).toBe(3);
  });

  it('resolves resolvableInBundle per subprocess procedureId', async () => {
    const processes = [
      makeProcess('p', 'to do parent'),
      makeProcess('c', 'to do child'),
    ];
    const callGraph: CallGraph = {
      nodes: processes.map((p) => ({ id: p.id, name: p.name })),
      edges: [{ from: 'p', to: 'c', callType: 'run' }],
      roots: ['p'],
      leaves: ['c'],
      cycles: [],
    };

    mockedAnalyze.mockImplementation(async (source: string) => {
      const ir = emptyIr();
      if (source === 'p') {
        ir.procedures = [
          {
            name: 'to do parent',
            nameValid: true,
            inputs: [],
            statements: [
              subprocessCall('c', 'to do child'), // in bundle
              subprocessCall('external-999', 'to do external'), // not in bundle
            ],
            triggers: [],
            startLine: 1,
            endLine: 3,
            flags: [],
          },
        ];
      }
      return { ir, tokens: { input: 5, output: 5 } };
    });

    const result = await analyzeBundle(makeBundle(processes, callGraph));

    const parentIr = result.irs.get('p');
    expect(parentIr).toBeDefined();
    const calls = subprocessCalls(parentIr as V1ProcessIR);
    const byName = new Map(calls.map((c) => [c.procedureId, c]));

    expect(byName.get('c')?.resolvableInBundle).toBe(true);
    expect(byName.get('external-999')?.resolvableInBundle).toBe(false);
  });

  it('records a per-process error without aborting the bundle', async () => {
    const processes = [
      makeProcess('ok', 'to do ok'),
      makeProcess('boom', 'to do boom'),
    ];
    const callGraph: CallGraph = {
      nodes: processes.map((p) => ({ id: p.id, name: p.name })),
      edges: [],
      roots: processes.map((p) => p.id),
      leaves: processes.map((p) => p.id),
      cycles: [],
    };

    mockedAnalyze.mockImplementation(async (source: string) => {
      if (source === 'boom') throw new Error('kaboom');
      return { ir: emptyIr(), tokens: { input: 1, output: 1 } };
    });

    const result = await analyzeBundle(makeBundle(processes, callGraph));

    expect(result.irs.size).toBe(1);
    expect(result.irs.has('ok')).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      procedureId: 'boom',
      procedureName: 'to do boom',
      error: 'kaboom',
    });
  });

  it('aggregates token usage into a USD cost via the configured rates', async () => {
    const processes = [makeProcess('p1', 'to do 1'), makeProcess('p2', 'to do 2')];
    const callGraph: CallGraph = {
      nodes: processes.map((p) => ({ id: p.id, name: p.name })),
      edges: [],
      roots: processes.map((p) => p.id),
      leaves: processes.map((p) => p.id),
      cycles: [],
    };

    mockedAnalyze.mockImplementation(async () => ({
      ir: emptyIr(),
      tokens: { input: 1_000_000, output: 1_000_000 },
    }));

    const result = await analyzeBundle(makeBundle(processes, callGraph), {
      costRates: { inputPerM: 2, outputPerM: 4 },
    });

    expect(result.tokenUsage.totalInput).toBe(2_000_000);
    expect(result.tokenUsage.totalOutput).toBe(2_000_000);
    // 2M/1M * 2 + 2M/1M * 4 = 4 + 8 = 12.
    expect(result.tokenUsage.totalCostUsd).toBeCloseTo(12, 5);
  });

  it('emits started/complete/done progress events', async () => {
    const processes = [makeProcess('only', 'to do only')];
    const callGraph: CallGraph = {
      nodes: [{ id: 'only', name: 'to do only' }],
      edges: [],
      roots: ['only'],
      leaves: ['only'],
      cycles: [],
    };

    mockedAnalyze.mockImplementation(async () => ({
      ir: emptyIr(),
      tokens: { input: 1, output: 1 },
    }));

    const events: string[] = [];
    await analyzeBundle(makeBundle(processes, callGraph), {
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toEqual(['started', 'process_complete', 'done']);
  });
});

// ---------------------------------------------------------------------------
// Integration test (real OpenAI; gated by RUN_INTEGRATION)
// ---------------------------------------------------------------------------

const RUN = Boolean(process.env.RUN_INTEGRATION);

const FIXTURE = fileURLToPath(
  new URL('../../samples/agent-bundles/01-vendor-helpdesk.har', import.meta.url),
);

const ENTRY_PROCESS = 'to process vendorhelpdesk emails';

describe.skipIf(!RUN)('analyzeBundle — vendor helpdesk bundle (real OpenAI)', () => {
  let bundle: ExtractedAgentBundle;
  let result: Awaited<ReturnType<typeof analyzeBundle>>;

  beforeAll(async () => {
    // Restore the REAL analyzer so the bundle actually hits OpenAI.
    const actual = await vi.importActual<
      typeof import('@/lib/analyzer/client')
    >('@/lib/analyzer/client');
    mockedAnalyze.mockImplementation(actual.analyzeProcess);

    const har = readFileSync(FIXTURE, 'utf8');
    bundle = await extractAgentBundleFromHar(har, {
      filename: '01-vendor-helpdesk.har',
    });

    result = await analyzeBundle(bundle);

    // Summary for the human running this.
    const nameById = new Map(bundle.processes.map((p) => [p.id, p.name]));
    console.log('\n[orchestrator integration] per-process timing:');
    for (const [id, ms] of result.timings.perProcessMs) {
      console.log(`  ${(ms / 1000).toFixed(1)}s  ${nameById.get(id) ?? id}`);
    }
    console.log(
      `[orchestrator integration] total: ${(result.timings.totalMs / 1000).toFixed(1)}s, ` +
        `cost: $${result.tokenUsage.totalCostUsd.toFixed(4)} ` +
        `(in ${result.tokenUsage.totalInput} / out ${result.tokenUsage.totalOutput} tokens)`,
    );
    if (result.errors.length > 0) {
      console.log('[orchestrator integration] errors:');
      for (const e of result.errors) {
        console.log(`  ${e.procedureName} (${e.procedureId}): ${e.error}`);
      }
    }
  }, 600_000);

  it('analyzes all 7 processes with no errors', () => {
    expect(result.errors).toHaveLength(0);
    expect(result.irs.size).toBe(7);
  });

  it('resolves every subprocess call in the entry process within the bundle', () => {
    const entry = bundle.processes.find((p) => p.name === ENTRY_PROCESS);
    expect(entry, `fixture must contain "${ENTRY_PROCESS}"`).toBeDefined();
    if (!entry) return;

    const ir = result.irs.get(entry.id);
    expect(ir, `IR for "${ENTRY_PROCESS}" must exist`).toBeDefined();
    if (!ir) return;

    const calls = subprocessCalls(ir);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(
        call.resolvableInBundle,
        `"${call.processName}" (${call.procedureId}) should be resolvable in bundle`,
      ).toBe(true);
    }
  });

  it('reports a sane, non-trivial cost', () => {
    expect(result.tokenUsage.totalCostUsd).toBeGreaterThan(0);
    expect(result.tokenUsage.totalCostUsd).toBeLessThan(5);
  });

  it('completes well within the time budget', () => {
    expect(result.timings.totalMs).toBeLessThan(600_000);
  });
});
