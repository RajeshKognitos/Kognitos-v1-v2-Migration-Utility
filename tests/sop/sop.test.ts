/**
 * Tests for the Phase 3 SOP + Test-Plan generator.
 *
 * Two suites:
 *  1. Fast unit tests (no API): Zod schema validation + prompt content.
 *  2. A REAL integration test (gated by RUN_INTEGRATION) that runs the full
 *     pipeline: HAR → extract → analyzeBundle → generateBundleSops. Run:
 *       RUN_INTEGRATION=1 OPENAI_API_KEY=sk-... npm test -- sop/sop
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, it, expect } from 'vitest';

import { extractAgentBundleFromHar } from '@/lib/har';
import { analyzeBundle } from '@/lib/analyzer/orchestrator';
import {
  buildSopSystemPrompt,
  buildSopUserPrompt,
  generateBundleSops,
  SopModelOutputSchema,
} from '@/lib/sop';
import type { SopModelOutputValidated } from '@/lib/sop';
import type { V1ProcessIR } from '@/types/ir';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal-but-valid model output for schema tests. */
const VALID_OUTPUT: SopModelOutputValidated = {
  sop: '# Send Approval Email\n\nWhen the invoice total exceeds $10,000, send an approval email.',
  testPlan: {
    processName: 'Send Approval Email',
    generatedAt: '2026-06-03T00:00:00.000Z',
    testCases: [
      {
        id: 'tc_001',
        name: 'Happy path - above threshold',
        description: 'Invoice over threshold triggers email',
        category: 'happy_path',
        priority: 'critical',
        inputs: {
          invoice_total: { type: 'number', value: 15000, source: 'synthetic' },
        },
        expectedOutputs: {
          email_sent: { matcher: 'equals', value: true },
        },
        expectedBehavior: [
          {
            type: 'integration_called',
            description: 'Email sent',
            details: { integration: 'Email' },
          },
        ],
      },
    ],
    validationStrategy: {
      primaryAssertion: 'output_match',
      secondaryChecks: ['No unexpected exceptions'],
    },
    prerequisites: ['Email Connection configured'],
  },
  connectionRequirements: [
    {
      integration: 'Email',
      reason: 'Sends the approval email',
      isCustomActionsIntegration: false,
    },
  ],
};

const EMPTY_IR: V1ProcessIR = {
  metadata: {
    rawSource: '',
    sourceLineCount: 0,
    parsedAt: '2026-01-01T00:00:00.000Z',
    parserVersion: '1.0.0',
  },
  procedures: [],
  flags: [],
};

// ---------------------------------------------------------------------------
// Unit tests (no API)
// ---------------------------------------------------------------------------

describe('SOP schema validation', () => {
  it('accepts a well-formed model output', () => {
    const result = SopModelOutputSchema.safeParse(VALID_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('rejects an empty sop string', () => {
    const bad = { ...VALID_OUTPUT, sop: '' };
    expect(SopModelOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid test-case category', () => {
    const bad = structuredClone(VALID_OUTPUT);
    // @ts-expect-error deliberately invalid category for the negative test
    bad.testPlan.testCases[0].category = 'smoke_test';
    expect(SopModelOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid expected-output matcher', () => {
    const bad = structuredClone(VALID_OUTPUT);
    // @ts-expect-error deliberately invalid matcher for the negative test
    bad.testPlan.testCases[0].expectedOutputs.email_sent.matcher = 'isnt';
    expect(SopModelOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('requires isCustomActionsIntegration on connection requirements', () => {
    const bad = structuredClone(VALID_OUTPUT);
    // @ts-expect-error deliberately drop a required field for the negative test
    delete bad.connectionRequirements[0].isCustomActionsIntegration;
    expect(SopModelOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('SOP prompt content', () => {
  const system = buildSopSystemPrompt();

  it('declares the JSON output contract (sop + testPlan + connectionRequirements)', () => {
    expect(system).toContain('sop');
    expect(system).toContain('testPlan');
    expect(system).toContain('connectionRequirements');
  });

  it('surfaces get vs find semantics (MR-2)', () => {
    expect(system).toContain('MR-2');
    expect(system.toLowerCase()).toContain('find');
    expect(system.toLowerCase()).toContain('pause');
  });

  it('handles parallel subprocess redesign (MR-19)', () => {
    expect(system).toContain('MR-19');
    expect(system.toLowerCase()).toContain('sequential');
  });

  it('references subprocesses by display name, not procedure id (MR-28)', () => {
    expect(system).toContain('MR-28');
    expect(system.toLowerCase()).toContain('procedureid');
  });

  it('enforces test coverage (happy/edge/error) and Custom Actions flagging', () => {
    expect(system).toContain('happy_path');
    expect(system).toContain('edge_case');
    expect(system).toContain('error_case');
    expect(system).toContain('Custom Actions');
    expect(system).toContain('Salesforce');
  });

  it('includes the v2 integration mapping for ServiceNow', () => {
    expect(system).toContain('ServiceNow');
  });

  it('user prompt embeds the bundle summary and the IR JSON', () => {
    const user = buildSopUserPrompt(EMPTY_IR, {
      bundleSummary: 'part of a bundle of 3 process(es): "a", "b", "c".',
    });
    expect(user).toContain('bundle of 3');
    expect(user).toContain('<ir>');
    expect(user).toContain('"procedures"');
  });
});

// ---------------------------------------------------------------------------
// Integration test (real OpenAI; gated by RUN_INTEGRATION)
// ---------------------------------------------------------------------------

const RUN = Boolean(process.env.RUN_INTEGRATION);

const FIXTURE = fileURLToPath(
  new URL('../../samples/agent-bundles/01-vendor-helpdesk.har', import.meta.url),
);

describe.skipIf(!RUN)('generateBundleSops — vendor helpdesk bundle (real OpenAI)', () => {
  let result: Awaited<ReturnType<typeof generateBundleSops>>;

  beforeAll(async () => {
    const har = readFileSync(FIXTURE, 'utf8');
    const bundle = await extractAgentBundleFromHar(har, {
      filename: '01-vendor-helpdesk.har',
    });
    const analyzed = await analyzeBundle(bundle);
    result = await generateBundleSops(analyzed);

    console.log('\n[sop integration] per-process timing:');
    for (const [id, ms] of result.timings.perProcessMs) {
      console.log(`  ${(ms / 1000).toFixed(1)}s  ${id}`);
    }
    console.log(
      `[sop integration] total: ${(result.timings.totalMs / 1000).toFixed(1)}s, ` +
        `cost: $${result.tokenUsage.totalCostUsd.toFixed(4)}, ` +
        `connections: ${result.aggregatedConnections.map((c) => c.integration).join(', ')}`,
    );
  }, 1_200_000);

  it('generates an SOP for all 7 processes with no errors', () => {
    expect(result.errors).toHaveLength(0);
    expect(result.sops.size).toBe(7);
  });

  it('every SOP has a non-empty sop string', () => {
    for (const [id, sop] of result.sops) {
      expect(sop.sop.trim().length, `empty SOP for ${id}`).toBeGreaterThan(0);
    }
  });

  it('aggregated connections include ServiceNow and Email', () => {
    const names = result.aggregatedConnections.map((c) =>
      c.integration.toLowerCase(),
    );
    expect(names.some((n) => n.includes('servicenow'))).toBe(true);
    expect(names.some((n) => n.includes('email'))).toBe(true);
  });

  it('at least one test plan has 3+ test cases', () => {
    const max = Math.max(
      ...[...result.sops.values()].map((s) => s.testPlan.testCases.length),
    );
    expect(max).toBeGreaterThanOrEqual(3);
  });

  it('reports a sane, non-trivial cost', () => {
    expect(result.tokenUsage.totalCostUsd).toBeGreaterThan(0);
    expect(result.tokenUsage.totalCostUsd).toBeLessThan(3);
  });
});
