/**
 * Runtime (Zod) schemas mirroring the SOP/Test-Plan types in `@/types/sop`.
 *
 * These validate the JSON the SOP generator returns from OpenAI. The TypeScript
 * types in `@/types/sop` remain the source of truth; the schemas here are kept
 * structurally identical. The top-level {@link SopModelOutputSchema} is annotated
 * with `z.ZodType<SopModelOutput>` so any structural drift between the schema
 * tree and the canonical types is caught at compile time.
 *
 * The model returns only `{ sop, testPlan, connectionRequirements }`; the
 * `metadata` block of `SopGenerationResult` is stamped deterministically by code
 * (see `client.ts`) and is therefore NOT part of the model-output schema.
 *
 * Strict TS, no `any`.
 */

import { z } from 'zod';

import type {
  ConnectionRequirement,
  SopGenerationResult,
  TestPlan,
} from '@/types/sop';

// ============================================================
// Test plan pieces
// ============================================================

export const TestInputSchema = z.object({
  type: z.enum(['text', 'number', 'boolean', 'date', 'file', 'list', 'table']),
  value: z.unknown(),
  source: z.enum(['synthetic', 'sample_from_ir', 'human_provided']),
});

export const ExpectedValueSchema = z.object({
  matcher: z.enum([
    'equals',
    'contains',
    'matches_regex',
    'is_type',
    'in_range',
    'is_present',
  ]),
  value: z.unknown().optional(),
  notes: z.string().optional(),
});

export const BehaviorAssertionSchema = z.object({
  type: z.enum([
    'integration_called',
    'exception_raised',
    'no_exception',
    'output_within_time',
  ]),
  description: z.string(),
  details: z.record(z.string(), z.unknown()),
});

export const TestFileSchema = z.object({
  name: z.string(),
  type: z.enum(['pdf', 'csv', 'xlsx', 'docx', 'image', 'text']),
  source: z.enum(['sample_repo', 'synthetic', 'upload_required']),
  path: z.string().optional(),
  description: z.string(),
});

export const ValidationStrategySchema = z.object({
  primaryAssertion: z.enum([
    'output_match',
    'integration_call_sequence',
    'state_change',
    'no_exception',
  ]),
  secondaryChecks: z.array(z.string()),
  toleranceNotes: z.string().optional(),
});

export const TestCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['happy_path', 'edge_case', 'error_case', 'integration']),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  inputs: z.record(z.string(), TestInputSchema),
  expectedOutputs: z.record(z.string(), ExpectedValueSchema),
  expectedBehavior: z.array(BehaviorAssertionSchema),
  files: z.array(TestFileSchema).optional(),
  setup: z.array(z.string()).optional(),
  teardown: z.array(z.string()).optional(),
});

/** Validated test plan. Mirrors {@link TestPlan}. */
export const TestPlanSchema: z.ZodType<TestPlan> = z.object({
  processName: z.string(),
  generatedAt: z.string(),
  testCases: z.array(TestCaseSchema),
  validationStrategy: ValidationStrategySchema,
  prerequisites: z.array(z.string()),
});

// ============================================================
// Connection requirements
// ============================================================

/** Validated v2 Connection requirement. Mirrors {@link ConnectionRequirement}. */
export const ConnectionRequirementSchema: z.ZodType<ConnectionRequirement> =
  z.object({
    integration: z.string(),
    reason: z.string(),
    setupUrl: z.string().optional(),
    isCustomActionsIntegration: z.boolean(),
  });

// ============================================================
// Model output (no metadata — that is code-stamped)
// ============================================================

/** The portion of {@link SopGenerationResult} the model is responsible for. */
type SopModelOutput = Pick<
  SopGenerationResult,
  'sop' | 'testPlan' | 'connectionRequirements'
>;

/**
 * Schema for the raw model output. Typed against {@link SopModelOutput} so the
 * schema tree cannot drift from the canonical types without a compile error.
 */
export const SopModelOutputSchema: z.ZodType<SopModelOutput> = z.object({
  sop: z.string().min(1),
  testPlan: TestPlanSchema,
  connectionRequirements: z.array(ConnectionRequirementSchema),
});

/** Validated model output, inferred from {@link SopModelOutputSchema}. */
export type SopModelOutputValidated = z.infer<typeof SopModelOutputSchema>;
