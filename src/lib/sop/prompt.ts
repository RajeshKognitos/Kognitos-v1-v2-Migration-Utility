/**
 * Prompt construction for the consolidated SOP + Test-Plan generator (Phase 3).
 *
 * One LLM call covers a whole process GROUP (a connected set of parent-child
 * processes), producing ONE business-process SOP document — objectives, scope,
 * business rules, an end-to-end procedure that folds sub-tasks in as
 * subsections — plus ONE end-to-end test plan and the union of v2 Connections.
 *
 * The system prompt pins the role, the JSON output contract (`sop`, `testPlan`,
 * `connectionRequirements`), the business-SOP section template, the SOP-quality
 * rules (MR-25-29), the behaviors that MUST surface (MR-2 get/find, MR-19
 * parallel subprocess, MR-43 HAR refs), test-plan coverage, and Connection
 * rules. A condensed book->integration mapping is inlined.
 *
 * Strict TS, no `any`.
 */

import type { CallGraph } from '@/lib/har';
import type { V1ProcessIR } from '@/types/ir';

import { buildHierarchyForest, hierarchyToText, type ProcessGroup } from './grouping';

/**
 * Condensed v1-book -> v2-Integration mapping, inlined as prompt context. Kept
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
 * Build the system prompt: role, output contract, business-SOP template, SOP
 * rules, surfaced behaviors, test-plan coverage, and Connection rules.
 */
export function buildConsolidatedSopSystemPrompt(): string {
  return `You convert one or more related Kognitos v1 processes (given as structured IRs,
with their parent-child call hierarchy) into a SINGLE consolidated, v2-ready
BUSINESS PROCESS SOP, plus one end-to-end test plan and the list of v2
Connections required. Your audience is a business analyst and the Kognitos v2
Draft builder, which generates Automation steps from natural-language intent.

The processes you receive form ONE business process: an entry-point process that
calls sub-task processes. Do NOT produce one SOP per process. Produce ONE SOP
that tells the end-to-end story, weaving each sub-task in as a subsection of the
overall procedure.

# OUTPUT CONTRACT
Return STRICT JSON — and ONLY JSON — matching this TypeScript shape exactly:

\`\`\`typescript
{
  sop: string;                         // ONE consolidated business SOP as Markdown
  testPlan: {
    processName: string;               // the business process (entry-point) name
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

# THE SOP IS A BUSINESS DOCUMENT (not a code translation)
The \`sop\` Markdown MUST be a real Standard Operating Procedure with these
sections, in this order (use Markdown headings):
1. "# <Business process name>" — a clear title for the end-to-end process.
2. "## Objective" — the business goal: what outcome this process achieves and WHY.
3. "## Scope" — what is and isn't covered; which sub-tasks participate.
4. "## Trigger" — how the process starts (schedule, inbound email, API, manual).
5. "## Roles & Owners" — who owns/operates it (use the provided owners; never invent real people).
6. "## Prerequisites" — required v2 Connections/Integrations and any setup.
7. "## Inputs" — the business inputs the process consumes.
8. "## Business Rules" — the decision logic as explicit rules (see MR-26).
9. "## Procedure" — the end-to-end steps. Organize sub-tasks as "### Sub-task: <name>" subsections, in the order they execute.
10. "## Exception Handling" — what pauses for a human vs continues (see MR-2/MR-19).
11. "## Outputs & Success Criteria" — what the process produces and how to know it succeeded.
12. "## Open Questions / Assumptions" — anything a human must confirm (omit the section if none).

# SOP RULES (MR-25 ... MR-29)
- MR-29 (intent over syntax): Describe BUSINESS INTENT — WHAT to do and WHY — in
  natural language. NEVER reproduce v1 DSL syntax. The SOP is conversational
  business prose, not a line-by-line translation of the IR.
- MR-25: Write naturally; do not treat "the" as a data sigil ("Get the customer's
  email", not "get customer email").
- MR-26: Express conditionals as explicit business rules ("When the total exceeds
  $10,000, escalate the invoice."), not "if total > 10000".
- MR-27: Loops become "For each X, do the following:".
- MR-28: Reference sub-tasks by their display NAME, never by procedureId — v2 has
  no concept of v1 procedure IDs.

# BEHAVIORS THAT MUST SURFACE IN THE SOP
- MR-2 (get vs find): These are NOT interchangeable and MUST be called out
  explicitly. "get"/"ask" PAUSE the run and ask a human when the value is missing;
  "find" returns "Not Found" and CONTINUES. State the pause-vs-continue behavior in
  plain language (e.g. "pause and ask the user ...", not "raise an exception").
- MR-19 (parallel subprocess): If any IR contains a 'start_parallel' subprocess or
  a PARALLEL_SUBPROCESS_NO_EQUIVALENT flag, v2 has NO parallel-run equivalent.
  Redesign the procedure to run those sub-tasks SEQUENTIALLY, and note that the
  original v1 process ran them in parallel and was converted to sequential.
- MR-43 (HAR refs): A sub-task may reference a process outside this group. Still
  describe the call by its display name; never drop it.

# TEST PLAN RULES (one end-to-end plan for the whole business process)
- Drive the test plan from the ENTRY-POINT process, exercising the full flow
  through its sub-tasks.
- Coverage (minimum): at least 1 happy_path (critical), 1 edge_case (high), and
  1 error_case (medium). Add 1 integration case (high) per book/integration used
  anywhere in the group.
- Realistic SYNTHETIC inputs only. NO real PII, real company names, or real
  emails. Prefer literal values found in the IRs (source 'sample_from_ir'); else
  generate plausible business values (source 'synthetic').
- The error_case should be triggered by a get/ask exception (missing required
  field) when the process has one (MR-2).
- If a parallel subprocess (MR-19) is present, note in that case's description
  that it cannot be auto-tested and needs human verification.

# CONNECTION REQUIREMENTS
- Enumerate EVERY v2 Integration used ACROSS THE WHOLE GROUP (one entry per
  distinct integration), derived from the IRs' book_usage statements and the
  mapping below.
- Set isCustomActionsIntegration = true for SAP, NetSuite, and Salesforce (their
  actions must be DISCOVERED in-product, not blindly remapped). false otherwise.
- Put the v2 docs URL in setupUrl when known. Use the v2 Integration NAME (not the
  v1 book name) in the 'integration' field.

# BOOK -> INTEGRATION MAPPING (condensed; v2 names authoritative)
${BOOK_MAPPING_CONTEXT}

# OUTPUT RULES
- Output ONLY the JSON object. No preamble, no commentary, no markdown fences.
- The first character of your response must be "{" and the last must be "}".`;
}

/** Inputs for {@link buildGroupSopUserPrompt}. */
export interface GroupSopPromptInput {
  /** The process group to document. */
  group: ProcessGroup;
  /** Analyzed IRs available in the bundle, keyed by procedure id. */
  irsById: Map<string, V1ProcessIR>;
  /** Display names keyed by procedure id. */
  nameById: Map<string, string>;
  /** The bundle call graph (for the hierarchy + roles). */
  callGraph: CallGraph;
  /** Optional process owners keyed by procedure id (for the Roles section). */
  ownersById?: Map<string, string | null>;
}

/**
 * Build the user prompt: the business process name, its parent-child hierarchy,
 * a per-member roster (role + owner), and each member IR (leaves-first), so the
 * model can write one end-to-end SOP that folds sub-tasks together.
 */
export function buildGroupSopUserPrompt(input: GroupSopPromptInput): string {
  const { group, irsById, nameById, callGraph, ownersById } = input;

  const entryName = nameById.get(group.entryIds[0]) ?? group.entryIds[0];
  const forest = buildHierarchyForest(group, callGraph, nameById);
  const hierarchy = hierarchyToText(forest);
  const entrySet = new Set(group.entryIds);

  const roster = group.orderedMemberIds
    .map((id) => {
      const name = nameById.get(id) ?? id;
      const role = entrySet.has(id) ? 'entry-point' : 'sub-task';
      const owner = ownersById?.get(id);
      const ownerStr = owner ? ` — owner: ${owner}` : '';
      const missing = irsById.has(id) ? '' : ' — (IR unavailable; describe from name only)';
      return `- ${name} [${role}]${ownerStr}${missing}`;
    })
    .join('\n');

  const irBlocks = group.orderedMemberIds
    .map((id) => {
      const ir = irsById.get(id);
      if (!ir) return '';
      const name = nameById.get(id) ?? id;
      return `### Process: ${name} (${entrySet.has(id) ? 'entry-point' : 'sub-task'})\n<ir>\n${JSON.stringify(ir, null, 2)}\n</ir>`;
    })
    .filter((b) => b.length > 0)
    .join('\n\n');

  const kindLine = group.isSingleton
    ? 'This is a single, standalone process (no sub-tasks).'
    : `This business process has ${group.memberIds.length} processes (one entry-point and its sub-tasks).`;

  return `Business process: "${entryName}"
${kindLine}

## Call hierarchy (parent -> child)
${hierarchy}

## Processes in this group (leaves-first)
${roster}

Generate ONE consolidated business SOP, one end-to-end test plan, and the union
of v2 connection requirements for the following process IRs. Return the JSON
object described in the system prompt.

${irBlocks}`;
}
