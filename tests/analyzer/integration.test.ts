/**
 * Real (un-mocked) analyzer integration test against OpenAI.
 *
 * GATED: skipped unless RUN_INTEGRATION is set (it hits the OpenAI API and
 * costs tokens). Run with:
 *   RUN_INTEGRATION=1 OPENAI_API_KEY=sk-... npm test -- analyzer/integration
 *
 * Flow: extract the vendor-helpdesk bundle → pick the entry-point process →
 * build CallGraphContext from its siblings → analyzeProcess → assert the IR
 * captured the subprocess calls (with resolvable procedureIds) and at least one
 * expected book. Token usage is logged by the analyzer client (see client.ts).
 *
 * NOTE on IR shape: V1ProcessIR has no top-level `subprocessCalls`/`diagnostics`
 * fields — subprocess calls are `subprocess_call` statements (possibly nested),
 * books are `book_usage` statements, and error-level findings are `flags` with
 * severity 'error'. The helpers below flatten the statement tree accordingly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, it, expect } from 'vitest';

import { extractAgentBundleFromHar } from '@/lib/har';
import { analyzeProcess, type CallGraphContext } from '@/lib/analyzer';
import type {
  BookUsageIR,
  Flag,
  StatementIR,
  SubprocessCallIR,
  V1ProcessIR,
} from '@/types/ir';

const RUN = Boolean(process.env.RUN_INTEGRATION);

const FIXTURE = fileURLToPath(
  new URL('../../samples/agent-bundles/01-vendor-helpdesk.har', import.meta.url),
);

const ENTRY_PROCESS = 'to process vendorhelpdesk emails';
const EXPECTED_BOOKS = ['servicenow', 'email', 'koncierge', 'idp'];

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

function allStatements(ir: V1ProcessIR): StatementIR[] {
  return ir.procedures.flatMap((p) => flattenStatements(p.statements));
}

function subprocessCalls(ir: V1ProcessIR): SubprocessCallIR[] {
  return allStatements(ir).filter(
    (s): s is SubprocessCallIR => s.kind === 'subprocess_call',
  );
}

function bookUsages(ir: V1ProcessIR): BookUsageIR[] {
  return allStatements(ir).filter(
    (s): s is BookUsageIR => s.kind === 'book_usage',
  );
}

function errorFlags(ir: V1ProcessIR): Flag[] {
  const procFlags = ir.procedures.flatMap((p) => p.flags);
  return [...ir.flags, ...procFlags].filter((f) => f.severity === 'error');
}

describe.skipIf(!RUN)('analyzeProcess — vendor helpdesk entry process (real OpenAI)', () => {
  let ir: V1ProcessIR;
  let bundleIds: Set<string>;

  beforeAll(async () => {
    const har = readFileSync(FIXTURE, 'utf8');
    const bundle = await extractAgentBundleFromHar(har, {
      filename: '01-vendor-helpdesk.har',
    });

    bundleIds = new Set(bundle.processes.map((p) => p.id));

    const target = bundle.processes.find((p) => p.name === ENTRY_PROCESS);
    expect(target, `fixture must contain "${ENTRY_PROCESS}"`).toBeDefined();
    if (!target) return;

    const context: CallGraphContext = {
      thisProcessName: target.name,
      bundleSize: bundle.processes.length,
      siblingProcedures: bundle.processes
        .filter((p) => p.id !== target.id)
        .map((p) => ({ name: p.name, procedureId: p.id })),
    };

    ir = await analyzeProcess(target.text, context);
  }, 120_000);

  it('captures at least two subprocess calls', () => {
    expect(subprocessCalls(ir).length).toBeGreaterThanOrEqual(2);
  });

  it('populates procedureId on every subprocess call', () => {
    for (const call of subprocessCalls(ir)) {
      expect(call.procedureId, `missing procedureId on "${call.processName}"`)
        .toBeTruthy();
    }
  });

  it('resolves every subprocess procedureId within the bundle', () => {
    for (const call of subprocessCalls(ir)) {
      expect(
        bundleIds.has(call.procedureId ?? ''),
        `procedureId ${call.procedureId} ("${call.processName}") not in bundle`,
      ).toBe(true);
    }
  });

  it('detects at least one expected book', () => {
    const detected = bookUsages(ir).map((b) => b.bookName.toLowerCase());
    const matched = detected.some((name) =>
      EXPECTED_BOOKS.some((expected) => name.includes(expected)),
    );
    expect(matched, `expected one of ${EXPECTED_BOOKS.join('/')}, got [${detected.join(', ')}]`)
      .toBe(true);
  });

  it('emits no error-level flags', () => {
    expect(errorFlags(ir)).toHaveLength(0);
  });
});
