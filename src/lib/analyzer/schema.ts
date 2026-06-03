/**
 * Runtime (Zod) schemas mirroring the V1 Process IR types in `@/types/ir`.
 *
 * These exist to validate the JSON that Claude returns from the analyzer. The
 * TypeScript types in `@/types/ir` remain the source of truth; the schemas here
 * are kept structurally identical so `z.infer<typeof V1ProcessIRSchema>` is
 * assignable to/from `V1ProcessIR`. Recursive nodes (`ExpressionIR`,
 * `StatementIR`) use `z.lazy` and are explicitly typed against the IR
 * interfaces so drift is caught at compile time.
 *
 * Strict TS, no `any`.
 */

import { z } from 'zod';

import type { ExpressionIR, StatementIR } from '@/types/ir';

// ============================================================
// Expressions (recursive discriminated union on `kind`)
// ============================================================

const LiteralExprSchema = z.object({
  kind: z.literal('literal'),
  type: z.enum(['string', 'number', 'boolean', 'date']),
  value: z.union([z.string(), z.number(), z.boolean()]),
  currency: z.string().optional(),
});

const IdentifierExprSchema = z.object({
  kind: z.literal('identifier'),
  name: z.string(),
});

const ReferenceExprSchema = z.object({
  kind: z.literal('reference'),
  path: z.array(z.string()),
});

/** Recursive expression union. Typed against {@link ExpressionIR}. */
export const ExpressionIRSchema: z.ZodType<ExpressionIR> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    LiteralExprSchema,
    IdentifierExprSchema,
    ReferenceExprSchema,
    ListExprSchema,
    TheAboveExprSchema,
  ]),
);

const ListExprSchema = z.object({
  kind: z.literal('list'),
  items: z.array(ExpressionIRSchema),
});

const TheAboveExprSchema = z.object({
  kind: z.literal('the_above'),
  resolvedTo: ExpressionIRSchema.optional(),
});

// ============================================================
// Conditions
// ============================================================

const ConditionIRSchema = z.object({
  raw: z.string(),
  left: ExpressionIRSchema.optional(),
  operator: z.string().optional(),
  right: ExpressionIRSchema.optional(),
});

// ============================================================
// Statements (recursive discriminated union on `kind`)
// ============================================================

const baseStatementFields = {
  line: z.number(),
  col: z.number(),
  indent: z.number(),
  rawText: z.string(),
} as const;

const parametersSchema = z.record(z.string(), ExpressionIRSchema);

const DataDefinitionIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('data_definition'),
  name: z.string(),
  value: ExpressionIRSchema,
});

const AssignmentIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('assignment'),
  operation: z.enum(['set', 'use']),
  target: z.string(),
  value: ExpressionIRSchema,
});

const ProcedureCallIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('procedure_call'),
  verb: z.string(),
  target: z.string().optional(),
  parameters: parametersSchema,
});

const ConditionalIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('conditional'),
  condition: ConditionIRSchema,
  thenBranch: z.array(z.lazy(() => StatementIRSchema)),
  elseBranch: z.array(z.lazy(() => StatementIRSchema)).optional(),
});

const LoopIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('loop'),
  iterableExpr: z.string(),
  body: z.array(z.lazy(() => StatementIRSchema)),
  hasCounter: z.boolean(),
});

const SubprocessCallIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('subprocess_call'),
  mechanism: z.enum(['run', 'invoke', 'start_parallel']),
  processName: z.string(),
  procedureId: z.string().optional(),
  parameters: parametersSchema,
  returnsResult: z.boolean(),
  resultName: z.string().optional(),
  resultNames: z.array(z.string()).optional(),
  resolvableInBundle: z.boolean().optional(),
});

const V2BookMappingSchema = z.object({
  v2IntegrationName: z.string(),
  v2Auth: z.string(),
  complexity: z.enum(['Direct', 'Moderate', 'Complex', 'Manual']),
  notes: z.string(),
});

const BookUsageIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('book_usage'),
  bookName: z.string(),
  action: z.string(),
  parameters: parametersSchema,
  isCustomBDK: z.boolean(),
  endpointUrl: z.string().optional(),
  v2Mapping: V2BookMappingSchema.optional(),
});

const ExceptionIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('exception'),
  type: z.enum(['ask', 'get', 'find']),
  expression: z.string(),
  choices: z.array(z.string()).optional(),
  pausesOnMissing: z.boolean(),
});

const ControlStatementIRSchema = z.object({
  ...baseStatementFields,
  kind: z.literal('control'),
  operation: z.enum([
    'say',
    'stop',
    'imagine',
    'add',
    'remove',
    'convert',
    'wait_for_runs',
  ]),
  target: z.string().optional(),
  expression: ExpressionIRSchema.optional(),
});

/** Recursive statement union. Typed against {@link StatementIR}. */
export const StatementIRSchema: z.ZodType<StatementIR> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    DataDefinitionIRSchema,
    AssignmentIRSchema,
    ProcedureCallIRSchema,
    ConditionalIRSchema,
    LoopIRSchema,
    SubprocessCallIRSchema,
    BookUsageIRSchema,
    ExceptionIRSchema,
    ControlStatementIRSchema,
  ]),
);

// ============================================================
// Inputs
// ============================================================

const InputDefSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  required: z.boolean(),
  source: z.enum(['parameter', 'undefined_reference', 'ask']),
});

// ============================================================
// Triggers (discriminated union on `kind`)
// ============================================================

const ScheduleTriggerIRSchema = z.object({
  kind: z.literal('schedule'),
  interval: z.enum(['hourly', 'daily', 'weekly', 'custom']),
  config: z.record(z.string(), z.string()),
  timezone: z.string().optional(),
});

const EmailTriggerIRSchema = z.object({
  kind: z.literal('email'),
  emailAddress: z.string().optional(),
  permissions: z.enum(['anyone', 'collaborators', 'restricted']).optional(),
});

const ApiTriggerIRSchema = z.object({
  kind: z.literal('api'),
  endpoint: z.string().optional(),
});

const TriggerIRSchema = z.discriminatedUnion('kind', [
  ScheduleTriggerIRSchema,
  EmailTriggerIRSchema,
  ApiTriggerIRSchema,
]);

// ============================================================
// Flags
// ============================================================

const FlagCodeSchema = z.enum([
  // Errors
  'PARALLEL_SUBPROCESS_NO_EQUIVALENT',
  'NO_V2_EQUIVALENT',
  'SCHEDULED_WITH_INPUTS',
  'INVALID_SUBPROCESS_NAME',
  // Warnings
  'CUSTOM_BDK_BOOK_REDEPLOY',
  'CUSTOM_ACTIONS_REQUIRED',
  'DATABASE_SPLIT_DEFAULT_MSSQL',
  'GET_SEMANTIC_PAUSE',
  'LOOP_OVER_SCALAR',
  'DEEP_SUBPROCESS_CHAIN',
  'RECURSIVE_PROCESS',
  'EXCEL_PATH_AMBIGUOUS',
  'CBL_CONFIDENCE_REVIEW',
  'DEPARTMENT_BOX_REVIEW',
  // Info
  'RE_POINT_TO_CURRENT',
  'WEBHOOK_TRIGGER_OPPORTUNITY',
  'NAMING_CAN_BE_FREE_FORM_IN_V2',
  'COMMENT_DROPPED',
]);

const FlagSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: FlagCodeSchema,
  message: z.string(),
  line: z.number().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================
// Procedure & top-level IR
// ============================================================

const ProcedureIRSchema = z.object({
  name: z.string(),
  nameValid: z.boolean(),
  inputs: z.array(InputDefSchema),
  statements: z.array(StatementIRSchema),
  triggers: z.array(TriggerIRSchema),
  startLine: z.number(),
  endLine: z.number(),
  flags: z.array(FlagSchema),
});

const ProcessMetadataSchema = z.object({
  rawSource: z.string(),
  sourceLineCount: z.number(),
  parsedAt: z.string(),
  parserVersion: z.string(),
});

/** Root schema for one analyzed v1 source file. Mirrors `V1ProcessIR`. */
export const V1ProcessIRSchema = z.object({
  metadata: ProcessMetadataSchema,
  procedures: z.array(ProcedureIRSchema),
  flags: z.array(FlagSchema),
});

/** Validated analyzer output, inferred from {@link V1ProcessIRSchema}. */
export type AnalyzerOutput = z.infer<typeof V1ProcessIRSchema>;
