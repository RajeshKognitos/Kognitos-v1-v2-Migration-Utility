# Parser Spec — Kognitos v1 DSL → IR

> The definitive grammar and IR specification for the v1 process parser. This doc is the source of truth for Phase 1 (Parser) implementation.
>
> **Input source:** The parser typically consumes one `ExtractedProcess.text` at a time from the HAR Extractor (see `12-input-specification.md`). It also supports raw text input from Tier-2 fallback (paste/upload).

---

## 1. Parser Goals

1. **Lossless capture of structure**: every line in the v1 source maps to an IR node
2. **Preservation of semantic distinctions** (e.g., `get` vs `find`, `run` vs `invoke`)
3. **Indentation-aware** parsing
4. **Error tolerance**: surface parse errors with line numbers; do not crash on malformed input
5. **Flag emission**: emit flags for migration-rules violations as defined in `04-migration-rules-and-edge-cases.md`

---

## 2. Lexical Rules

### Whitespace
- Indentation: tabs OR spaces, normalized to spaces (1 tab = 2 spaces)
- Line continuation: not supported in v1 DSL — each line is a complete statement
- Empty lines: ignored for parsing, preserved in source line tracking

### Comments
- `#` starts a comment to end-of-line
- Comments are stripped during parse but optionally retained as IR metadata

### String literals
- Double-quoted: `"hello world"`
- Backtick-quoted (for identifiers with spaces): `` `the customer's email` ``

### Identifiers
- Data names: always prefixed with `the` (e.g., `the customer`, `the invoice number`)
- Procedure names: must start with `to` OR end with `is`/`if`/`are` (validated, flagged if invalid)
- Book/integration names: lowercase, single word (e.g., `salesforce`, `outlook`)

### Numbers
- Integers: `100`, `1000`
- Decimals: `1.5`, `3.14`
- Currency: parsed as decimal, currency symbol captured as metadata (e.g., `$1000` → `{value: 1000, currency: "USD"}`)

---

## 3. Grammar Rules (EBNF-ish)

```
process       ::= procedure_definition+

procedure_definition ::= name_line statement_block

name_line     ::= identifier_starting_with_to | identifier_ending_with_is_if_are

statement     ::= data_definition
                | procedure_call
                | conditional
                | loop
                | subprocess_call
                | book_usage
                | exception
                | control_statement

data_definition ::= "the" identifier "is" expression
                  | "the" identifier "are" expression_list

procedure_call ::= verb [target] ["where" parameter_block]

parameter_block ::= INDENT parameter+ DEDENT
parameter     ::= "the" identifier "is" expression

conditional   ::= "if" condition "then" INDENT statement+ DEDENT
                  ["else" INDENT statement+ DEDENT]

loop          ::= "process each" identifier "as follows" INDENT statement+ DEDENT

subprocess_call ::= run_call | invoke_call | parallel_call

run_call      ::= "run" procedure_ref [parameter_block] [return_capture]
invoke_call   ::= "invoke" procedure_ref ["with" expression_list]
parallel_call ::= "start a run where" parameter_block

procedure_ref ::= procedure_name
                | har_inline_ref      # NEW: when source is HAR-extracted

# HAR-extracted source uses inline JSON references with procedure IDs:
# @{"type": "procedure", "display": "process name", "value": "procedureId"}
har_inline_ref ::= "@" "{" json_object "}"

return_capture ::= "the result is" identifier
                 | "the results are" identifier_list

book_usage    ::= verb_phrase ["from"|"in"|"to"] book_name [parameter_block]
                | "learn from" string_literal

exception     ::= ask_statement | get_statement | find_statement

ask_statement ::= "ask" string_literal ["the choices are" expression_list]
get_statement ::= "get" path_expression
find_statement ::= "find" path_expression

control_statement ::= "say" expression
                    | "stop"
                    | "imagine" expression
                    | "set the" identifier "to" expression
                    | "use" expression "as the" identifier
                    | "add" expression "to the" identifier
                    | "remove" expression ["from the" identifier]
                    | "convert" expression "to" type_name
                    | "wait for the runs"
```

---

## 4. IR Schema (TypeScript)

```typescript
// ============================================================
// Top-level IR
// ============================================================

export interface V1ProcessIR {
  metadata: ProcessMetadata;
  procedures: ProcedureIR[];      // Multiple procedures per file possible
  flags: Flag[];                  // Top-level flags
}

export interface ProcessMetadata {
  rawSource: string;
  sourceLineCount: number;
  parsedAt: string;               // ISO timestamp
  parserVersion: string;
}

// ============================================================
// Procedure
// ============================================================

export interface ProcedureIR {
  name: string;                   // e.g. "to process invoices"
  nameValid: boolean;             // follows v1 naming rules
  inputs: InputDef[];             // inferred from context
  statements: StatementIR[];
  triggers: TriggerIR[];          // schedule/email/api/webhook
  startLine: number;
  endLine: number;
  flags: Flag[];
}

export interface InputDef {
  name: string;
  type?: string;                  // inferred (text, number, table, etc.)
  required: boolean;
  source: 'parameter' | 'undefined_reference' | 'ask';
}

// ============================================================
// Statements (discriminated union)
// ============================================================

export type StatementIR =
  | DataDefinitionIR
  | ProcedureCallIR
  | ConditionalIR
  | LoopIR
  | SubprocessCallIR
  | BookUsageIR
  | ExceptionIR
  | ControlStatementIR;

export interface BaseStatement {
  kind: string;
  line: number;
  indent: number;
  rawText: string;
}

// ----- Data Definition -----
export interface DataDefinitionIR extends BaseStatement {
  kind: 'data_definition';
  name: string;                   // without "the" prefix
  value: ExpressionIR;
}

// ----- Procedure Call -----
export interface ProcedureCallIR extends BaseStatement {
  kind: 'procedure_call';
  verb: string;                   // e.g. "extract data", "send an email"
  target?: string;                // e.g. "from the document"
  parameters: Record<string, ExpressionIR>;
}

// ----- Conditional -----
export interface ConditionalIR extends BaseStatement {
  kind: 'conditional';
  condition: ConditionIR;
  thenBranch: StatementIR[];
  elseBranch?: StatementIR[];
}

export interface ConditionIR {
  raw: string;                    // original expression
  left?: ExpressionIR;
  operator?: string;              // <, >, =, contains, ...
  right?: ExpressionIR;
}

// ----- Loop -----
export interface LoopIR extends BaseStatement {
  kind: 'loop';
  iterableExpr: string;           // e.g. "document" (from "process each document")
  body: StatementIR[];
  hasCounter: boolean;            // detected counter pattern
}

// ----- Subprocess -----
export interface SubprocessCallIR extends BaseStatement {
  kind: 'subprocess_call';
  mechanism: 'run' | 'invoke' | 'start_parallel';
  processName: string;            // human-readable from `display` field
  procedureId?: string;           // v1 procedure ID (from HAR @{...} ref); enables call graph
  parameters: Record<string, ExpressionIR>;
  returnsResult: boolean;
  resultName?: string;            // from "the result is X"
  resultNames?: string[];         // from "the results are X, Y, Z"
  resolvableInBundle?: boolean;   // set by enricher: true if procedureId is in the same HAR bundle
}

// ----- Book Usage -----
export interface BookUsageIR extends BaseStatement {
  kind: 'book_usage';
  bookName: string;               // e.g. "salesforce", "outlook"
  action: string;                 // e.g. "create a contact"
  parameters: Record<string, ExpressionIR>;
  isCustomBDK: boolean;
  endpointUrl?: string;           // if `learn from "..."` precedes
  v2Mapping?: V2BookMapping;      // populated by mapping enricher
}

export interface V2BookMapping {
  v2IntegrationName: string;
  v2Auth: string;
  complexity: 'Direct' | 'Moderate' | 'Complex' | 'Manual';
  notes: string;
}

// ----- Exception -----
export interface ExceptionIR extends BaseStatement {
  kind: 'exception';
  type: 'ask' | 'get' | 'find';
  expression: string;
  choices?: string[];             // for `ask` with `the choices are ...`
  pausesOnMissing: boolean;       // true for `ask`, `get`; false for `find`
}

// ----- Control Statement -----
export interface ControlStatementIR extends BaseStatement {
  kind: 'control';
  operation: 'say' | 'stop' | 'imagine' | 'set' | 'use' | 'add' | 'remove' | 'convert' | 'wait_for_runs';
  target?: string;
  expression?: ExpressionIR;
}

// ============================================================
// Expressions
// ============================================================

export type ExpressionIR =
  | LiteralExpr
  | IdentifierExpr
  | ReferenceExpr
  | ListExpr
  | TheAboveExpr;

export interface LiteralExpr {
  kind: 'literal';
  type: 'string' | 'number' | 'boolean' | 'date';
  value: string | number | boolean;
  currency?: string;              // for monetary literals
}

export interface IdentifierExpr {
  kind: 'identifier';
  name: string;                   // without "the" prefix
}

export interface ReferenceExpr {
  kind: 'reference';
  path: string[];                 // e.g. ["customer", "email"] for "the customer's email"
}

export interface ListExpr {
  kind: 'list';
  items: ExpressionIR[];
}

export interface TheAboveExpr {
  kind: 'the_above';
  resolvedTo?: ExpressionIR;      // populated by post-parse resolver
}

// ============================================================
// Triggers
// ============================================================

export type TriggerIR =
  | ScheduleTriggerIR
  | EmailTriggerIR
  | ApiTriggerIR;

export interface ScheduleTriggerIR {
  kind: 'schedule';
  interval: 'hourly' | 'daily' | 'weekly' | 'custom';
  config: Record<string, string>;
  timezone?: string;
}

export interface EmailTriggerIR {
  kind: 'email';
  emailAddress?: string;
  permissions?: 'anyone' | 'collaborators' | 'restricted';
}

export interface ApiTriggerIR {
  kind: 'api';
  endpoint?: string;
}

// ============================================================
// Flags (for migration warnings/errors)
// ============================================================

export interface Flag {
  severity: 'error' | 'warning' | 'info';
  code: FlagCode;                 // see codes below
  message: string;
  line?: number;
  context?: Record<string, unknown>;
}

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
```

---

## 5. Parser Implementation Notes

### Recommended structure
```
/lib/parser/
  ├── tokenizer.ts        # Source → tokens
  ├── indent.ts           # Indent-depth tracker
  ├── grammar.ts          # Statement-by-statement parsing
  ├── expressions.ts      # Expression parsing
  ├── bookMapping.ts      # Enrich book_usage nodes with v2 mapping
  ├── flagger.ts          # Walk IR and emit flags per migration rules
  ├── resolver.ts         # Resolve `the above` references
  └── index.ts            # parseV1Process(source: string): V1ProcessIR
```

### Parsing strategy
**Two-pass parse:**
1. **Pass 1 — Tokenize and build raw statement tree** (indent-aware)
2. **Pass 2 — Enrich** with book mappings, resolve `the above`, run flagger

### Key algorithms

**Indent tracking:**
```typescript
function getIndent(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === ' ') count++;
    else if (char === '\t') count += 2;
    else break;
  }
  return count;
}
```

**Block extraction:**
Given a parent line at indent N, the block consists of all subsequent lines at indent > N until a line at indent ≤ N is encountered.

**Book name detection:**
Match against known book name list (from `06-book-integration-mapping.csv`). Case-insensitive. If unmatched, flag `UNKNOWN_BOOK`.

---

## 6. Sample Parse — End-to-End

### Input (v1 source)
```
to process invoices
  process each invoice as follows
    extract data from the invoice where
      the first field is "invoice number"
    if the total > 10000 then
      ask "Approve this invoice?" the choices are "yes", "no"
      if the above is "yes" then
        run mark as approved
          the invoice is the invoice
```

### Expected IR (abridged)
```json
{
  "metadata": { "sourceLineCount": 9, "parsedAt": "2026-06-02T..." },
  "procedures": [{
    "name": "to process invoices",
    "nameValid": true,
    "inputs": [],
    "statements": [{
      "kind": "loop",
      "line": 2,
      "iterableExpr": "invoice",
      "body": [
        {
          "kind": "procedure_call",
          "line": 3,
          "verb": "extract data",
          "target": "from the invoice",
          "parameters": { "first field": { "kind": "literal", "type": "string", "value": "invoice number" } }
        },
        {
          "kind": "conditional",
          "line": 5,
          "condition": { "raw": "the total > 10000", "left": { "kind": "identifier", "name": "total" }, "operator": ">", "right": { "kind": "literal", "type": "number", "value": 10000 } },
          "thenBranch": [
            {
              "kind": "exception",
              "line": 6,
              "type": "ask",
              "expression": "Approve this invoice?",
              "choices": ["yes", "no"],
              "pausesOnMissing": true
            },
            {
              "kind": "conditional",
              "line": 7,
              "condition": { "raw": "the above is \"yes\"", "left": { "kind": "the_above" }, "operator": "=", "right": { "kind": "literal", "type": "string", "value": "yes" } },
              "thenBranch": [{
                "kind": "subprocess_call",
                "line": 8,
                "mechanism": "run",
                "processName": "mark as approved",
                "parameters": { "invoice": { "kind": "identifier", "name": "invoice" } },
                "returnsResult": false
              }]
            }
          ]
        }
      ]
    }],
    "triggers": [],
    "flags": []
  }],
  "flags": []
}
```

---

## 7. Testing Requirements

### Unit tests per parser function (min 3 cases each)
1. **Happy path** — well-formed input
2. **Edge case** — unusual but valid (deeply nested, empty branches, etc.)
3. **Malformed** — invalid syntax → produces useful error, doesn't crash

### Integration tests
- Parse each sample v1 process file in project knowledge
- Assert IR matches expected snapshot
- Assert all expected flags are emitted

### Fuzz tests
- Random whitespace insertion
- Random comment insertion
- Random line reordering (should detect malformed)

---

## 8. Performance Targets

- Parse a 500-line v1 process in < 200ms
- Memory: O(n) in source length
- No external API calls in parser layer (book mapping is local lookup)

---

## 9. What the Parser Does NOT Do

- Does NOT execute v1 processes
- Does NOT validate against a v1 schema (Kognitos doesn't publish one)
- Does NOT generate v2 SOP (that's the SOP generator's job in Phase 3)
- Does NOT call the Claude API
- Does NOT persist anything
