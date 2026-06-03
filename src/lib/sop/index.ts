/**
 * SOP + Test-Plan generator — public entry point (Phase 3).
 *
 * OpenAI-backed generator that turns an analyzed `V1ProcessIR` into a v2-ready
 * SOP, a validated test plan, and the list of required v2 Connections. See
 * `./client.ts` (orchestration), `./prompt.ts` (prompting), `./schema.ts`
 * (runtime validation), and `./orchestrator.ts` (bundle-level fan-out).
 */

export {
  generateSopAndTestPlan,
  SopGenerationError,
  SOP_GENERATOR_VERSION,
} from './client';
export type { SopTokenUsage } from './client';
export { buildSopSystemPrompt, buildSopUserPrompt } from './prompt';
export type { SopContext } from './prompt';
export {
  SopModelOutputSchema,
  TestPlanSchema,
  TestCaseSchema,
  TestInputSchema,
  ExpectedValueSchema,
  BehaviorAssertionSchema,
  TestFileSchema,
  ValidationStrategySchema,
  ConnectionRequirementSchema,
} from './schema';
export type { SopModelOutputValidated } from './schema';
export { generateBundleSops } from './orchestrator';
export type {
  BundleSopResult,
  BundleSopError,
  GenerateBundleSopsOptions,
} from './orchestrator';
export type {
  TestPlan,
  TestCase,
  TestCaseCategory,
  TestCasePriority,
  TestInput,
  ExpectedValue,
  BehaviorAssertion,
  TestFile,
  ValidationStrategy,
  ConnectionRequirement,
  SopGenerationResult,
  SopGenerationMetadata,
} from '@/types/sop';
