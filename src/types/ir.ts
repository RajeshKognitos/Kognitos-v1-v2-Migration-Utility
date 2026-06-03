/**
 * V1 Process Intermediate Representation (IR).
 *
 * Canonical, typed output of the Phase 1 parser. Mirrors `docs/05-parser-spec.md`
 * Section 4, with two reviewed deviations:
 *   - `AssignmentIR` is promoted to a first-class statement (kind `'assignment'`)
 *     for `set the X to …` / `use … as the X`; consequently `set`/`use` are
 *     removed from `ControlStatementIR.operation` to keep the union unambiguous.
 *   - `ProcedureDefIR` is exported as an alias of `ProcedureIR`.
 *
 * Strict TS, no `any`. Every export is documented.
 */

// ============================================================
// Top-level IR
// ============================================================

/** Root IR for one parsed v1 source file (may contain multiple procedures). */
export interface V1ProcessIR {
  /** Provenance + parse metadata. */
  metadata: ProcessMetadata;
  /** Every `to …`/`… is`/`… are` procedure defined in the source. */
  procedures: ProcedureIR[];
  /** File-level migration flags not attributable to a single procedure. */
  flags: Flag[];
}

/** Provenance and parse-time metadata for a parsed source file. */
export interface ProcessMetadata {
  /** The exact source text that was parsed. */
  rawSource: string;
  /** Number of physical lines in `rawSource`. */
  sourceLineCount: number;
  /** ISO-8601 timestamp of when the parse ran. */
  parsedAt: string;
  /** Semantic version of the parser that produced this IR. */
  parserVersion: string;
}

// ============================================================
// Procedure
// ============================================================

/**
 * A single v1 procedure definition: its name line plus the indented body of
 * statements, along with inferred inputs and any triggers.
 */
export interface ProcedureIR {
  /** Full procedure name, e.g. `"to process invoices"`. */
  name: string;
  /** True when the name follows v1 rules (starts with `to` or ends `is`/`if`/`are`). */
  nameValid: boolean;
  /** Inputs inferred from parameters, undefined references, or `ask` calls. */
  inputs: InputDef[];
  /** Ordered body statements. */
  statements: StatementIR[];
  /** Schedule / email / API triggers attached to this procedure. */
  triggers: TriggerIR[];
  /** 1-based line where the name line appears. */
  startLine: number;
  /** 1-based line of the last statement in the body. */
  endLine: number;
  /** Procedure-scoped migration flags. */
  flags: Flag[];
}

/**
 * Alias of {@link ProcedureIR}. The grammar refers to this node as a
 * "procedure definition"; provided for call-sites that prefer that name.
 */
export type ProcedureDefIR = ProcedureIR;

/** A single inferred input to a procedure. */
export interface InputDef {
  /** Input name without the `the` prefix. */
  name: string;
  /** Inferred type (`text`, `number`, `table`, …) when known. */
  type?: string;
  /** Whether the input must be supplied for the procedure to run. */
  required: boolean;
  /** How the input was discovered. */
  source: 'parameter' | 'undefined_reference' | 'ask';
}

// ============================================================
// Statements (discriminated union on `kind`)
// ============================================================

/**
 * Discriminated union of every statement node. Narrow on the `kind` field.
 */
export type StatementIR =
  | DataDefinitionIR
  | AssignmentIR
  | ProcedureCallIR
  | ConditionalIR
  | LoopIR
  | SubprocessCallIR
  | BookUsageIR
  | ExceptionIR
  | ControlStatementIR;

/** Fields shared by every statement node, for source traceability. */
export interface BaseStatement {
  /** Discriminator. */
  kind: string;
  /** 1-based source line of the statement. */
  line: number;
  /** 1-based source column where the statement begins. */
  col: number;
  /** Normalized indentation width (spaces; tabs counted as 2). */
  indent: number;
  /** Verbatim source text of the statement (trailing whitespace stripped). */
  rawText: string;
}

/** `the X is E` / `the X are E1, E2, …` — declares/defines a data value. */
export interface DataDefinitionIR extends BaseStatement {
  kind: 'data_definition';
  /** Data name without the `the` prefix. */
  name: string;
  /** Assigned value (a {@link ListExpr} for the `are` form). */
  value: ExpressionIR;
}

/**
 * `set the X to E` / `use E as the X` — mutates/assigns an existing data value.
 * Distinct from {@link DataDefinitionIR} (which declares with `is`/`are`).
 */
export interface AssignmentIR extends BaseStatement {
  kind: 'assignment';
  /** Surface form that produced this assignment. */
  operation: 'set' | 'use';
  /** Target data name without the `the` prefix. */
  target: string;
  /** Value assigned to the target. */
  value: ExpressionIR;
}

/** A verb-led action call, e.g. `extract data from the document where …`. */
export interface ProcedureCallIR extends BaseStatement {
  kind: 'procedure_call';
  /** Verb phrase, e.g. `"extract data"`, `"send an email"`. */
  verb: string;
  /** Optional target phrase, e.g. `"from the document"`. */
  target?: string;
  /** Named parameters from the `where` block, keyed by name (no `the` prefix). */
  parameters: Record<string, ExpressionIR>;
}

/** `if <condition> then … [else …]`. */
export interface ConditionalIR extends BaseStatement {
  kind: 'conditional';
  /** Parsed condition (with raw fallback). */
  condition: ConditionIR;
  /** Statements executed when the condition holds. */
  thenBranch: StatementIR[];
  /** Optional statements executed otherwise. */
  elseBranch?: StatementIR[];
}

/** A parsed boolean condition; `left/operator/right` are best-effort. */
export interface ConditionIR {
  /** Original condition text. */
  raw: string;
  /** Left operand, when decomposable. */
  left?: ExpressionIR;
  /** Comparison/logical operator, e.g. `<`, `>`, `=`, `contains`. */
  operator?: string;
  /** Right operand, when decomposable. */
  right?: ExpressionIR;
}

/** `process each X as follows` over a collection. */
export interface LoopIR extends BaseStatement {
  kind: 'loop';
  /** Iterable name without the `the` prefix, e.g. `"invoice"`. */
  iterableExpr: string;
  /** Loop body statements. */
  body: StatementIR[];
  /** True when a counter pattern was detected in the body. */
  hasCounter: boolean;
}

/** `run` / `invoke` / `start a run` of another procedure (subprocess). */
export interface SubprocessCallIR extends BaseStatement {
  kind: 'subprocess_call';
  /** How the subprocess is invoked. */
  mechanism: 'run' | 'invoke' | 'start_parallel';
  /** Human-readable target name (from the HAR ref `display`, or inline name). */
  processName: string;
  /** v1 procedure ID from a HAR `@{…}` ref; enables call-graph linkage. */
  procedureId?: string;
  /** Named arguments passed to the subprocess. */
  parameters: Record<string, ExpressionIR>;
  /** True when the call captures a return value. */
  returnsResult: boolean;
  /** Single result name from `the result is X`. */
  resultName?: string;
  /** Multiple result names from `the results are X, Y, Z`. */
  resultNames?: string[];
  /** Set by the enricher: true if `procedureId` is in the same HAR bundle. */
  resolvableInBundle?: boolean;
}

/** Use of a v1 book/integration (e.g. Salesforce, Outlook). */
export interface BookUsageIR extends BaseStatement {
  kind: 'book_usage';
  /** Detected book key, e.g. `"salesforce"`. */
  bookName: string;
  /** Action phrase, e.g. `"create a contact"`. */
  action: string;
  /** Named parameters for the action. */
  parameters: Record<string, ExpressionIR>;
  /** True for custom BDK books (`learn from "https://…"`). */
  isCustomBDK: boolean;
  /** Endpoint URL captured from a preceding `learn from "…"`. */
  endpointUrl?: string;
  /** v2 mapping populated later by the mapping enricher. */
  v2Mapping?: V2BookMapping;
}

/** v2 integration mapping attached to a {@link BookUsageIR} by the enricher. */
export interface V2BookMapping {
  /** Target v2 Integration name. */
  v2IntegrationName: string;
  /** Auth method required for the v2 Connection. */
  v2Auth: string;
  /** Estimated migration complexity. */
  complexity: 'Direct' | 'Moderate' | 'Complex' | 'Manual';
  /** Free-form migration notes. */
  notes: string;
}

/** `ask` / `get` / `find` — becomes a v2 Guidance Center exception. */
export interface ExceptionIR extends BaseStatement {
  kind: 'exception';
  /** Which exception verb produced this node. */
  type: 'ask' | 'get' | 'find';
  /** Question text (`ask`) or path expression (`get`/`find`). */
  expression: string;
  /** Acceptable answers from `the choices are …` (for `ask`). */
  choices?: string[];
  /** True for `ask`/`get` (pause on missing); false for `find` (continue). */
  pausesOnMissing: boolean;
}

/**
 * Misc. control verbs. `set`/`use` are intentionally NOT here — see
 * {@link AssignmentIR}.
 */
export interface ControlStatementIR extends BaseStatement {
  kind: 'control';
  /** Which control operation this represents. */
  operation:
    | 'say'
    | 'stop'
    | 'imagine'
    | 'add'
    | 'remove'
    | 'convert'
    | 'wait_for_runs';
  /** Optional target phrase (e.g. for `add … to the X`). */
  target?: string;
  /** Optional operand expression. */
  expression?: ExpressionIR;
}

// ============================================================
// Expressions (discriminated union on `kind`)
// ============================================================

/** Discriminated union of value/reference expressions. */
export type ExpressionIR =
  | LiteralExpr
  | IdentifierExpr
  | ReferenceExpr
  | ListExpr
  | TheAboveExpr;

/** A literal value (string, number, boolean, or date). */
export interface LiteralExpr {
  kind: 'literal';
  /** Literal subtype. */
  type: 'string' | 'number' | 'boolean' | 'date';
  /** Literal value (string text, numeric value, or boolean). */
  value: string | number | boolean;
  /** ISO-4217-ish currency code for monetary literals (e.g. `"USD"`). */
  currency?: string;
}

/** A simple data name reference, e.g. `the total` → `total`. */
export interface IdentifierExpr {
  kind: 'identifier';
  /** Name without the `the` prefix. */
  name: string;
}

/** A possessive/dotted path, e.g. `the customer's email` → `["customer","email"]`. */
export interface ReferenceExpr {
  kind: 'reference';
  /** Path segments, outermost first. */
  path: string[];
}

/** A comma-separated list of expressions (the `are` / `the … are …` form). */
export interface ListExpr {
  kind: 'list';
  /** List items in source order. */
  items: ExpressionIR[];
}

/** `the above` positional reference (MR-4); resolved post-parse. */
export interface TheAboveExpr {
  kind: 'the_above';
  /** Filled by the resolver with the previous statement's output expression. */
  resolvedTo?: ExpressionIR;
}

// ============================================================
// Triggers (discriminated union on `kind`)
// ============================================================

/** Discriminated union of trigger types. */
export type TriggerIR = ScheduleTriggerIR | EmailTriggerIR | ApiTriggerIR;

/** A schedule trigger (cron / interval). */
export interface ScheduleTriggerIR {
  kind: 'schedule';
  /** Coarse interval bucket. */
  interval: 'hourly' | 'daily' | 'weekly' | 'custom';
  /** Raw schedule config (e.g. `{ cron: "cron(20 18 * * ? *)" }`). */
  config: Record<string, string>;
  /** Timezone, when known (v2 requires it explicitly — see MR-38). */
  timezone?: string;
}

/** An email-address trigger. */
export interface EmailTriggerIR {
  kind: 'email';
  /** Trigger email address, when known. */
  emailAddress?: string;
  /** Who may trigger via email. */
  permissions?: 'anyone' | 'collaborators' | 'restricted';
}

/** A REST/API trigger. */
export interface ApiTriggerIR {
  kind: 'api';
  /** Endpoint path/URL, when known. */
  endpoint?: string;
}

// ============================================================
// Flags (migration warnings/errors emitted by the flagger)
// ============================================================

/** A migration flag emitted while walking the IR (see MR-30 severities). */
export interface Flag {
  /** Severity tier. */
  severity: 'error' | 'warning' | 'info';
  /** Stable flag code. */
  code: FlagCode;
  /** Human-readable explanation. */
  message: string;
  /** Optional 1-based source line. */
  line?: number;
  /** Optional structured context. */
  context?: Record<string, unknown>;
}

/** All migration flag codes (grouped by severity in `docs/05-parser-spec.md`). */
export type FlagCode =
  // Errors
  | 'PARALLEL_SUBPROCESS_NO_EQUIVALENT'
  | 'NO_V2_EQUIVALENT'
  | 'SCHEDULED_WITH_INPUTS'
  | 'INVALID_SUBPROCESS_NAME'
  // Warnings
  | 'CUSTOM_BDK_BOOK_REDEPLOY'
  | 'CUSTOM_ACTIONS_REQUIRED'
  | 'DATABASE_SPLIT_DEFAULT_MSSQL'
  | 'GET_SEMANTIC_PAUSE'
  | 'LOOP_OVER_SCALAR'
  | 'DEEP_SUBPROCESS_CHAIN'
  | 'RECURSIVE_PROCESS'
  | 'EXCEL_PATH_AMBIGUOUS'
  | 'CBL_CONFIDENCE_REVIEW'
  | 'DEPARTMENT_BOX_REVIEW'
  // Info
  | 'RE_POINT_TO_CURRENT'
  | 'WEBHOOK_TRIGGER_OPPORTUNITY'
  | 'NAMING_CAN_BE_FREE_FORM_IN_V2'
  | 'COMMENT_DROPPED';

// ============================================================
// Parser results & diagnostics
// ============================================================

/**
 * A parse-time diagnostic (lexer/grammar level). Distinct from {@link Flag},
 * which captures migration-rule findings rather than parse problems.
 */
export interface ParserDiagnostic {
  /** Diagnostic severity. */
  level: 'error' | 'warning' | 'info';
  /** Stable diagnostic code, e.g. `"MIXED_INDENTATION"`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** 1-based source line (0 if not applicable). */
  line: number;
  /** 1-based source column (0 if not applicable). */
  col: number;
}

/** Result of a parse: the IR (null on fatal failure) plus diagnostics. */
export interface ParserResult {
  /** Parsed IR, or null if parsing failed fatally. */
  ir: V1ProcessIR | null;
  /** All diagnostics gathered during the parse. */
  diagnostics: ParserDiagnostic[];
}
