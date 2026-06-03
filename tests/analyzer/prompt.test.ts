/**
 * Prompt-builder tests for the analyzer (fast, no API).
 *
 * Asserts the system prompt pins the output contract (JSON), embeds the IR
 * schema, and references the key migration rules; and that the user prompt
 * carries the source text plus sibling procedure names + IDs.
 */

import { describe, it, expect } from 'vitest';

import {
  buildSystemPrompt,
  buildUserPrompt,
  type CallGraphContext,
} from '@/lib/analyzer';

describe('buildSystemPrompt', () => {
  const system = buildSystemPrompt();

  it('is non-empty', () => {
    expect(system.trim().length).toBeGreaterThan(0);
  });

  it('pins JSON as the output contract', () => {
    expect(system).toContain('JSON');
  });

  it('embeds the IR schema', () => {
    expect(system).toContain('interface V1ProcessIR');
    expect(system).toContain('type StatementIR');
    expect(system).toContain('type ExpressionIR');
  });

  it('references the key migration rules (MR-2, MR-19)', () => {
    expect(system).toContain('MR-2');
    expect(system).toContain('MR-19');
  });

  it('states detection rules for subprocesses and exception semantics', () => {
    expect(system).toContain('start a run');
    expect(system).toContain('PARALLEL_SUBPROCESS_NO_EQUIVALENT');
    expect(system).toContain('GET_SEMANTIC_PAUSE');
  });
});

describe('buildUserPrompt', () => {
  const source = 'to process vendorhelpdesk emails\n  invoke to triage the email';
  const context: CallGraphContext = {
    thisProcessName: 'to process vendorhelpdesk emails',
    bundleSize: 3,
    siblingProcedures: [
      { name: 'to triage the email', procedureId: 'proc-aaa' },
      { name: 'respond to vendorQuery2', procedureId: 'proc-bbb' },
    ],
  };
  const user = buildUserPrompt(source, context);

  it('is non-empty', () => {
    expect(user.trim().length).toBeGreaterThan(0);
  });

  it('includes the verbatim source text', () => {
    expect(user).toContain(source);
  });

  it('includes each sibling procedure name and ID', () => {
    for (const sibling of context.siblingProcedures) {
      expect(user).toContain(sibling.name);
      expect(user).toContain(sibling.procedureId);
    }
  });

  it('states the bundle size and this process name', () => {
    expect(user).toContain(String(context.bundleSize));
    expect(user).toContain(context.thisProcessName);
  });
});
