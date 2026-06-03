/**
 * Prompt construction for the Claude-backed Process Analyzer (Phase 1).
 *
 * The system prompt pins the role, the exact output contract (the IR schema
 * inlined as TypeScript), the detection heuristics, and the relevant migration
 * rules (MR-2, MR-19, MR-43). The user prompt carries the process source plus
 * just enough call-graph context for Claude to resolve HAR procedure refs to
 * sibling processes in the same bundle.
 *
 * Strict TS, no `any`.
 */

/**
 * Minimal call-graph context handed to the analyzer so HAR `@{…}` procedure
 * refs can be resolved to real sibling processes in the same bundle.
 */
export interface CallGraphContext {
  /** Other processes in this bundle, as `{ name, procedureId }` pairs. */
  siblingProcedures: { name: string; procedureId: string }[];
  /** Total number of processes in the bundle (including this one). */
  bundleSize: number;
  /** Human-readable name of the process being analyzed. */
  thisProcessName: string;
}

/**
 * The IR schema, inlined as TypeScript, so Claude emits JSON matching it
 * exactly. Kept in sync with `@/types/ir` and `./schema.ts`.
 */
const IR_SCHEMA_TS = `
interface V1ProcessIR {
  metadata: {
    rawSource: string;        // exact source text analyzed
    sourceLineCount: number;  // physical line count of rawSource
    parsedAt: string;         // ISO-8601 timestamp
    parserVersion: string;    // analyzer version string
  };
  procedures: ProcedureIR[];
  flags: Flag[];              // file-level flags not tied to one procedure
}

interface ProcedureIR {
  name: string;              // full name, e.g. "to process invoices"
  nameValid: boolean;        // true if name starts with "to" OR ends with "is"/"if"/"are"
  inputs: InputDef[];
  statements: StatementIR[];
  triggers: TriggerIR[];
  startLine: number;         // 1-based line of the name line
  endLine: number;           // 1-based line of the last body statement
  flags: Flag[];             // procedure-scoped flags
}

interface InputDef {
  name: string;              // without the "the" prefix
  type?: string;             // "text" | "number" | "table" | ... when known
  required: boolean;
  source: 'parameter' | 'undefined_reference' | 'ask';
}

type StatementIR =
  | DataDefinitionIR | AssignmentIR | ProcedureCallIR | ConditionalIR
  | LoopIR | SubprocessCallIR | BookUsageIR | ExceptionIR | ControlStatementIR;

// Every statement carries these base fields:
//   line: number; col: number; indent: number; rawText: string;
// (indent = normalized leading spaces, tabs counted as 2; rawText = verbatim line)

interface DataDefinitionIR  { kind: 'data_definition'; name: string; value: ExpressionIR; /* + base */ }
interface AssignmentIR      { kind: 'assignment'; operation: 'set' | 'use'; target: string; value: ExpressionIR; /* + base */ }
interface ProcedureCallIR   { kind: 'procedure_call'; verb: string; target?: string; parameters: Record<string, ExpressionIR>; /* + base */ }
interface ConditionalIR     { kind: 'conditional'; condition: ConditionIR; thenBranch: StatementIR[]; elseBranch?: StatementIR[]; /* + base */ }
interface LoopIR            { kind: 'loop'; iterableExpr: string; body: StatementIR[]; hasCounter: boolean; /* + base */ }
interface SubprocessCallIR  {
  kind: 'subprocess_call';
  mechanism: 'run' | 'invoke' | 'start_parallel';
  processName: string;       // from HAR ref "display", or the inline name
  procedureId?: string;      // from a HAR @{...} ref "value"
  parameters: Record<string, ExpressionIR>;
  returnsResult: boolean;
  resultName?: string;       // from "the result is X"
  resultNames?: string[];    // from "the results are X, Y, Z"
  /* + base */
}
interface BookUsageIR       {
  kind: 'book_usage';
  bookName: string;          // e.g. "salesforce", "email", "idp", "sap"
  action: string;            // action phrase, e.g. "create a contact"
  parameters: Record<string, ExpressionIR>;
  isCustomBDK: boolean;      // true for "learn from \\"https://…\\"" books
  endpointUrl?: string;      // captured from a preceding learn-from URL
  /* + base */
}
interface ExceptionIR       {
  kind: 'exception';
  type: 'ask' | 'get' | 'find';
  expression: string;        // question text (ask) or path expression (get/find)
  choices?: string[];        // from "the choices are …" (ask only)
  pausesOnMissing: boolean;  // true for ask/get, false for find
  /* + base */
}
interface ControlStatementIR {
  kind: 'control';
  operation: 'say' | 'stop' | 'imagine' | 'add' | 'remove' | 'convert' | 'wait_for_runs';
  target?: string;
  expression?: ExpressionIR;
  /* + base */
}

interface ConditionIR { raw: string; left?: ExpressionIR; operator?: string; right?: ExpressionIR; }

type ExpressionIR =
  | { kind: 'literal'; type: 'string' | 'number' | 'boolean' | 'date'; value: string | number | boolean; currency?: string }
  | { kind: 'identifier'; name: string }                 // "the total" -> { name: "total" }
  | { kind: 'reference'; path: string[] }                // "the customer's email" -> { path: ["customer","email"] }
  | { kind: 'list'; items: ExpressionIR[] }
  | { kind: 'the_above' };                               // "the above" positional ref

type TriggerIR =
  | { kind: 'schedule'; interval: 'hourly' | 'daily' | 'weekly' | 'custom'; config: Record<string, string>; timezone?: string }
  | { kind: 'email'; emailAddress?: string; permissions?: 'anyone' | 'collaborators' | 'restricted' }
  | { kind: 'api'; endpoint?: string };

interface Flag {
  severity: 'error' | 'warning' | 'info';
  code: FlagCode;
  message: string;
  line?: number;
  context?: Record<string, unknown>;
}

type FlagCode =
  // errors
  | 'PARALLEL_SUBPROCESS_NO_EQUIVALENT' | 'NO_V2_EQUIVALENT' | 'SCHEDULED_WITH_INPUTS' | 'INVALID_SUBPROCESS_NAME'
  // warnings
  | 'CUSTOM_BDK_BOOK_REDEPLOY' | 'CUSTOM_ACTIONS_REQUIRED' | 'DATABASE_SPLIT_DEFAULT_MSSQL' | 'GET_SEMANTIC_PAUSE'
  | 'LOOP_OVER_SCALAR' | 'DEEP_SUBPROCESS_CHAIN' | 'RECURSIVE_PROCESS' | 'EXCEL_PATH_AMBIGUOUS'
  | 'CBL_CONFIDENCE_REVIEW' | 'DEPARTMENT_BOX_REVIEW'
  // info
  | 'RE_POINT_TO_CURRENT' | 'WEBHOOK_TRIGGER_OPPORTUNITY' | 'NAMING_CAN_BE_FREE_FORM_IN_V2' | 'COMMENT_DROPPED';
`.trim();

/**
 * Build the system prompt: role, output contract, detection rules, reference
 * rules, and output rules.
 */
export function buildSystemPrompt(): string {
  return `You analyze Kognitos v1 process source code and produce a structured IR.

You are a precise static analyzer. Given the source text of one v1 process file
(which may define multiple procedures) you emit a single JSON object that
captures every procedure, statement, expression, trigger, and migration flag.

# OUTPUT CONTRACT
Return STRICT JSON that matches this TypeScript schema exactly. Every statement
object MUST include the base fields (line, col, indent, rawText) in addition to
its kind-specific fields. Use the discriminator field ("kind") on every
statement, expression, and trigger. Do not invent fields. Omit optional fields
rather than setting them to null.

\`\`\`typescript
${IR_SCHEMA_TS}
\`\`\`

# COMPLETENESS (CRITICAL)
Parse EVERY statement in the source, in order. This is a faithful structural
parse, NOT a summary.
- Do NOT omit, merge, summarize, abbreviate, or "simplify" any statement.
- Preserve nesting EXACTLY: statements inside an "if … then" go in thenBranch;
  statements after "else" go in elseBranch; statements inside a loop go in body.
  NEVER hoist a nested statement to the top level.
- Recurse into EVERY branch, including deeply nested else-branches and
  if-inside-else chains. The last statements of a long process are as important
  as the first — a "run …" or "invoke …" buried at the bottom of a nested else
  MUST still appear in the IR.
- Lines beginning at indent 0 are top-level; deeper indents belong to the most
  recent enclosing block. Use indentation to reconstruct the tree.
- Comment lines (starting with "#") are skipped, but they do NOT terminate the
  enclosing block — keep parsing the statements that follow.
- Before finishing, re-scan the source bottom-up and confirm every "run @{…}",
  "invoke @{…}", "start a run", and "ask koncierge" in the text has a
  corresponding node in your output.

# DETECTION RULES
- Subprocess calls: phrases like "run X", "invoke X", or "start a run where …".
  EVERY occurrence of "run …" or "invoke …" (especially "run @{…}" / "invoke
  @{…}") is a subprocess_call — never a procedure_call. There are often MULTIPLE
  subprocess calls in one process; emit one node for each.
  * "run X" / "invoke X" -> mechanism "run" / "invoke".
  * "start a run where …" -> mechanism "start_parallel" (parallel execution).
  * Capture result binding: "the result is X" -> resultName "X" and
    returnsResult true; "the results are X, Y, Z" -> resultNames [X,Y,Z].
- HAR refs: a subprocess target may appear as a HAR procedure reference of the
  form @{"type": "procedure", "display": "<name>", "value": "<ID>"}. Set
  processName from "display" and procedureId from "value".
- Book usages: detect references to v1 books/integrations, including
  email/outlook/gmail, salesforce, servicenow, idp / koncierge ("ask koncierge"),
  sap, http, pdf, excel / microsoft excel, database, and similar. Normalize
  bookName to a lowercase key (e.g. "salesforce", "email", "idp", "sap",
  "http", "pdf", "excel"). "learn from \\"https://…\\"" -> isCustomBDK true and
  capture endpointUrl.
- Exceptions vs book usage — THIS IS A COMMON MISTAKE, read carefully:
  * "ask koncierge" (with or without an indented "the task is …" block) is ALWAYS
    a BOOK USAGE: kind "book_usage", bookName "idp", action "ask koncierge".
    It is NOT an exception. Do not emit kind "exception" for "ask koncierge".
    Fold the indented "the task is …"/"the rules are …"/"the … model is …"
    lines into its parameters.
  * "extract data from …" / "extract the data from …" (Koncierge/IDP extraction)
    is ALSO a book_usage with bookName "idp"; fold the indented "the … field
    is …"/"the … rule is …"/"the extraction mode is …" lines into parameters.
  * "ask the user …" / "ask …" (a genuine question to a human) -> ExceptionIR
    with type "ask", pausesOnMissing true. Capture "the choices are …" into
    choices. (Only use "exception" when the audience is a human, never koncierge.)
  * "get the X" -> ExceptionIR with type "get", pausesOnMissing true.
  * "find the X" -> ExceptionIR with type "find", pausesOnMissing false.
- Flags:
  * If any "start a run" (parallel subprocess) is found, add flag
    PARALLEL_SUBPROCESS_NO_EQUIVALENT (severity "error").
  * If any "get" exception semantics are used, add flag GET_SEMANTIC_PAUSE
    (severity "warning").
  Attach a flag to the owning procedure's flags when it stems from one
  procedure; otherwise place it in the top-level flags array.

# REFERENCE RULES (Kognitos migration rules)
- MR-2 (ask/get/find semantics): "get" pauses the run with a question when the
  value is missing; "find" returns "Not Found" and continues; "ask" pauses to
  ask the user. These are NOT interchangeable — tag each distinctly and set
  pausesOnMissing accordingly (ask/get = true, find = false).
- MR-19 (parallel subprocess): "start a run … / wait for the runs / get the
  runs's results" has NO direct v2 equivalent — flag it as an error.
- MR-43 (HAR refs): a subprocess @{…} ref may point at a process not present in
  this bundle. Still populate procedureId from the ref's "value"; do not drop
  the call. Resolution against the bundle happens downstream.

# OUTPUT RULES
- Output ONLY the JSON object. No preamble, no explanation, no commentary.
- No markdown code fences. The first character of your response must be "{" and
  the last must be "}".
- Completeness over brevity: it is better to emit a large, fully-expanded IR
  than a short one. Never truncate the parse to save space.`;
}

/**
 * Build the user prompt: the process source plus bundle/sibling context so
 * Claude can resolve HAR procedure refs.
 */
export function buildUserPrompt(
  source: string,
  context: CallGraphContext,
): string {
  const siblingLines =
    context.siblingProcedures.length > 0
      ? context.siblingProcedures
          .map((s) => `  - "${s.name}" (procedureId: ${s.procedureId})`)
          .join('\n')
      : '  (none — this is the only process in the bundle)';

  const bundleNames = [
    context.thisProcessName,
    ...context.siblingProcedures.map((s) => s.name),
  ]
    .map((n) => `"${n}"`)
    .join(', ');

  return `This process is part of a bundle of ${context.bundleSize} process(es): ${bundleNames}.

The process being analyzed is "${context.thisProcessName}".

Sibling procedures in the bundle (use these to resolve HAR @{…} subprocess refs:
match a ref's "value" to a procedureId below, and its "display" to the name):
${siblingLines}

Analyze the following v1 process source and return the IR JSON:

<source>
${source}
</source>`;
}
