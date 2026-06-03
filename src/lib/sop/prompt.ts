/**
 * Prompt construction for the SOP + Test-Plan generator (Phase 3).
 *
 * The system prompt pins the role, the exact output contract (a single JSON
 * object with `sop`, `testPlan`, `connectionRequirements`), the SOP-quality
 * rules (MR-25–29), the behaviors that MUST surface in the SOP (MR-2 get/find,
 * MR-19 parallel subprocess, MR-43 HAR refs), the test-plan coverage rules, and
 * the Connection-requirement rules. A condensed book→integration mapping (from
 * `docs/06-book-integration-mapping.csv`) is inlined so the model uses correct
 * v2 Integration names and flags Custom-Actions integrations.
 *
 * Strict TS, no `any`.
 */

import type { V1ProcessIR } from '@/types/ir';

/**
 * Context handed to the user prompt: a one-line summary of the bundle this
 * process belongs to, so the SOP can reference sibling sub-tasks by name.
 */
export interface SopContext {
  /** e.g. "part of a bundle of 7 processes: \"to do X\", \"to do Y\", …". */
  bundleSummary: string;
}

/**
 * Condensed v1-book → v2-Integration mapping, inlined as prompt context. Kept
 * intentionally short (the high-frequency books); the model is told to use the
 * v2 Integration name and to treat SAP / NetSuite / Salesforce as Custom
 * Actions. Source of truth: `docs/06-book-integration-mapping.csv`.
 */
const BOOK_MAPPING_CONTEXT = `
v1 book key            -> v2 Integration name              | Custom Actions? | v2 docs
email / outlook / gmail -> Email / Microsoft Outlook / Gmail | no            | https://docs.kognitos.com/guides/platform/integrations/outlook
servicenow             -> ServiceNow                        | no            | https://docs.kognitos.com/guides/platform/integrations/servicenow
salesforce             -> Salesforce                        | YES (discover) | https://docs.kognitos.com/guides/platform/integrations/salesforce
sap                    -> SAP                               | YES (discover) | https://docs.kognitos.com/guides/platform/integrations/sap
netsuite               -> NetSuite                          | YES (discover) | https://docs.kognitos.com/guides/platform/integrations/knetsuite
idp / koncierge        -> Intelligent Document Processing (IDP) | no        | https://docs.kognitos.com/guides/platform/integrations/idp
pdf                    -> PDF                               | no            | https://docs.kognitos.com/guides/platform/integrations/pdf
excel (local)          -> Excel (standalone)               | no            | https://docs.kognitos.com/guides/platform/integrations/excel-standalone
excel (online)         -> Microsoft Excel                   | no            | https://docs.kognitos.com/guides/platform/integrations/excel
database               -> MSSQL (default) or Postgres       | no            | https://docs.kognitos.com/guides/platform/integrations/mssql
http                   -> HTTP                              | no            | https://docs.kognitos.com/guides/platform/integrations/http
slack                  -> Slack                             | no            | https://docs.kognitos.com/guides/platform/integrations/slack
sharepoint             -> Microsoft SharePoint              | no            | https://docs.kognitos.com/guides/platform/integrations/sharepoint
s3                     -> S3                                | no            | https://docs.kognitos.com/guides/platform/integrations/s3
`.trim();

/**
 * Build the system prompt: role, output contract, SOP rules, surfaced
 * behaviors, test-plan coverage rules, and Connection-requirement rules.
 */
export function buildSopSystemPrompt(): string {
  return `You convert a Kognitos v1 process (given as a structured IR) into v2-ready
migration artifacts: a conversational SOP, a structured test plan, and the list
of v2 Connections required. Your audience is the Kognitos v2 Draft builder,
which generates Automation steps from natural-language intent.

# OUTPUT CONTRACT
Return STRICT JSON — and ONLY JSON — matching this TypeScript shape exactly:

\`\`\`typescript
{
  sop: string;                         // v2-ready SOP as Markdown
  testPlan: {
    processName: string;
    generatedAt: string;               // ISO-8601
    testCases: {
      id: string;                      // "tc_001"
      name: string;                    // "[category] - [scenario]"
      description: string;
      category: 'happy_path' | 'edge_case' | 'error_case' | 'integration';
      priority: 'critical' | 'high' | 'medium' | 'low';
      inputs: Record<string, { type: 'text'|'number'|'boolean'|'date'|'file'|'list'|'table'; value: unknown; source: 'synthetic'|'sample_from_ir'|'human_provided' }>;
      expectedOutputs: Record<string, { matcher: 'equals'|'contains'|'matches_regex'|'is_type'|'in_range'|'is_present'; value?: unknown; notes?: string }>;
      expectedBehavior: { type: 'integration_called'|'exception_raised'|'no_exception'|'output_within_time'; description: string; details: Record<string, unknown> }[];
      files?: { name: string; type: 'pdf'|'csv'|'xlsx'|'docx'|'image'|'text'; source: 'sample_repo'|'synthetic'|'upload_required'; path?: string; description: string }[];
      setup?: string[];
      teardown?: string[];
    }[];
    validationStrategy: { primaryAssertion: 'output_match'|'integration_call_sequence'|'state_change'|'no_exception'; secondaryChecks: string[]; toleranceNotes?: string };
    prerequisites: string[];
  };
  connectionRequirements: { integration: string; reason: string; setupUrl?: string; isCustomActionsIntegration: boolean }[];
}
\`\`\`

Omit optional fields rather than setting them to null. Do not invent fields.

# SOP RULES (MR-25 … MR-29)
- MR-29 (intent over syntax): Describe the BUSINESS INTENT — WHAT to do and WHY
  — in natural language. NEVER reproduce v1 DSL syntax. The SOP is conversational
  prose with step-by-step structure, not a line-by-line translation.
- MR-25: Write naturally; do not treat "the" as a data sigil ("Get the customer's
  email", not "get customer email").
- MR-26: Express conditionals as explicit business rules ("When the total exceeds
  $10,000, escalate the invoice."), not "if total > 10000".
- MR-27: Loops become "For each X, do the following:".
- MR-28: Subprocess calls — short ones inline as narrative; long ones as their own
  "**Sub-task: <name>**" section. ALWAYS reference subprocesses by their display
  NAME (processName), never by procedureId — v2 has no concept of v1 procedure IDs.

# BEHAVIORS THAT MUST SURFACE IN THE SOP
- MR-2 (get vs find): These are NOT interchangeable and MUST be called out
  explicitly. "get"/"ask" PAUSE the run and ask a human when the value is missing;
  "find" returns "Not Found" and CONTINUES. State the pause-vs-continue behavior in
  plain language (per MR-32, e.g. "pause and ask the user …", not "raise an
  exception").
- MR-19 (parallel subprocess): If the IR contains a 'start_parallel' subprocess or
  a PARALLEL_SUBPROCESS_NO_EQUIVALENT flag, v2 has NO parallel-run equivalent.
  Redesign the SOP to run those sub-tasks SEQUENTIALLY, and add a clear note that
  the original v1 process ran them in parallel and was converted to sequential.
- MR-43 (HAR refs): A subprocess may reference a process outside this bundle.
  Still describe the call by its display name; never drop it.

# TEST PLAN RULES
- Coverage (minimum): at least 1 happy_path (critical), 1 edge_case (high), and
  1 error_case (medium). Add 1 integration case (high) per book/integration used.
- Realistic SYNTHETIC inputs only. NO real PII, real company names, or real
  emails. Prefer literal values found in the IR (source 'sample_from_ir'); else
  generate plausible business values (source 'synthetic').
- The error_case should be triggered by a get/ask exception (missing required
  field) when the process has one (MR-2).
- If a parallel subprocess (MR-19) is present, note in that case's description
  that it cannot be auto-tested and needs human verification.

# CONNECTION REQUIREMENTS
- Enumerate EVERY v2 Integration the process uses (one entry per distinct
  integration), derived from the IR's book_usage statements and the mapping below.
- Set isCustomActionsIntegration = true for SAP, NetSuite, and Salesforce (their
  actions must be DISCOVERED in-product, not blindly remapped). false otherwise.
- Put the v2 docs URL in setupUrl when known. Use the v2 Integration NAME (not the
  v1 book name) in the 'integration' field.

# BOOK → INTEGRATION MAPPING (condensed; v2 names authoritative)
${BOOK_MAPPING_CONTEXT}

# OUTPUT RULES
- Output ONLY the JSON object. No preamble, no commentary, no markdown fences.
- The first character of your response must be "{" and the last must be "}".`;
}

/**
 * Build the user prompt: brief bundle context plus the full IR as JSON.
 */
export function buildSopUserPrompt(ir: V1ProcessIR, context: SopContext): string {
  return `This process is ${context.bundleSummary}

Generate the v2 SOP, test plan, and connection requirements for the following v1
process IR. Return the JSON object described in the system prompt.

<ir>
${JSON.stringify(ir, null, 2)}
</ir>`;
}
