/**
 * Zod schema validation tests for the analyzer (fast, no API).
 *
 * Confirms a hand-built minimal `V1ProcessIR` validates, and that two malformed
 * variants (missing required field; bad enum value) fail with errors pointing
 * at the offending path.
 */

import { describe, it, expect } from 'vitest';

import { V1ProcessIRSchema } from '@/lib/analyzer';
import type { V1ProcessIR } from '@/types/ir';

function makeValidIR(): V1ProcessIR {
  return {
    metadata: {
      rawSource: 'to greet the user\n  say "hello"',
      sourceLineCount: 2,
      parsedAt: '2026-06-03T00:00:00.000Z',
      parserVersion: '1.0.0',
    },
    procedures: [
      {
        name: 'to greet the user',
        nameValid: true,
        inputs: [],
        statements: [
          {
            kind: 'data_definition',
            line: 2,
            col: 3,
            indent: 2,
            rawText: 'the greeting is "hello"',
            name: 'greeting',
            value: { kind: 'literal', type: 'string', value: 'hello' },
          },
          {
            kind: 'subprocess_call',
            line: 3,
            col: 3,
            indent: 2,
            rawText: 'run to send the greeting',
            mechanism: 'run',
            processName: 'to send the greeting',
            procedureId: 'proc-123',
            parameters: {},
            returnsResult: false,
          },
        ],
        triggers: [],
        startLine: 1,
        endLine: 3,
        flags: [],
      },
    ],
    flags: [],
  };
}

describe('V1ProcessIRSchema', () => {
  it('validates a minimal, well-formed IR', () => {
    const result = V1ProcessIRSchema.safeParse(makeValidIR());
    expect(result.success).toBe(true);
  });

  it('fails when a required field is missing (metadata.parsedAt)', () => {
    const invalid = makeValidIR();
    // Drop a required field without using `any`.
    delete (invalid.metadata as Partial<V1ProcessIR['metadata']>).parsedAt;

    const result = V1ProcessIRSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('metadata.parsedAt');
    }
  });

  it('fails on a bad enum value (flag severity)', () => {
    const invalid = {
      ...makeValidIR(),
      flags: [
        {
          severity: 'critical',
          code: 'GET_SEMANTIC_PAUSE',
          message: 'not a real severity',
        },
      ],
    };

    const result = V1ProcessIRSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('flags.0.severity');
    }
  });
});
