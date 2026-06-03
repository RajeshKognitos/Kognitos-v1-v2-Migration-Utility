/**
 * Process Analyzer — public entry point (Phase 1).
 *
 * Claude-backed analyzer that turns one v1 process source into validated
 * `V1ProcessIR`. See `./client.ts` (orchestration), `./prompt.ts` (prompting),
 * and `./schema.ts` (runtime validation).
 */

export { analyzeProcess, AnalyzerError, ANALYZER_VERSION } from './client';
export type { AnalyzeProcessResult, AnalyzerTokenUsage } from './client';
export { V1ProcessIRSchema } from './schema';
export type { AnalyzerOutput } from './schema';
export type { CallGraphContext } from './prompt';
export { buildSystemPrompt, buildUserPrompt } from './prompt';
export { analyzeBundle, DEFAULT_COST_RATES } from './orchestrator';
export type {
  AnalyzeBundleOptions,
  AnalyzedBundle,
  BundleAnalysisError,
  ProgressEvent,
} from './orchestrator';
