# Migration Rules & Edge Cases

> The "watch out for" doc. Every rule here exists because something will break or behave subtly wrong if missed. Numbered for cross-reference (cite as `MR-N`).

---

## A. Hard Rules — Parser/IR Layer

### MR-1: Indentation is structurally significant
v1 uses indentation (tabs or spaces) to mark loop bodies, conditional branches, and procedure parameter blocks. The parser MUST track indent depth precisely.

**Edge cases:**
- Mixed tabs and spaces in the same file → normalize to spaces (1 tab = 2 spaces); warn user
- Trailing whitespace on lines → strip before depth calc
- Empty lines inside an indented block → preserve as part of the block, do not break the block

### MR-2: `get` vs `find` semantics are NOT interchangeable
`get` pauses the run with a Question if the value is missing. `find` returns "Not Found" and continues. The parser MUST tag these distinctly in the IR. The SOP generator MUST surface this distinction in v2 guidance.

**Example:**
```
get the customer's email   # if missing → run pauses, asks user
find the customer's phone  # if missing → continues with "Not Found"
```

### MR-3: All data names are prefixed with `the`
The parser must strip `the ` when storing names in IR but preserve original spelling in source line references. When generating v2 SOP, drop the `the` prefix (e.g., "the customer's email" → "the customer's email" stays in source but "customer email" or "email of the customer" in v2 SOP).

### MR-4: `the above` is a positional reference
`the above` refers to the value computed on the previous line. Parser must resolve this to the IR by capturing the previous step's output and inlining the reference.

**Edge case:** `the above` after a multi-line procedure call → refers to the procedure's result, not the last parameter line.

### MR-5: `add` is context-dependent
`add` can mean arithmetic, date math, or table row insertion. The parser must inspect operand types in the IR to disambiguate.

**Examples:**
- `add 1 to the counter` → arithmetic
- `add 5 days to the start date` → date math
- `add a row to the table where the name is "John"` → table insert

### MR-6: `process each X as follows` requires X to be a collection
If X is not a collection (table, list), the parser flags `LOOP_OVER_SCALAR` as a warning. Common v1 anti-pattern: looping over what the user thinks is a collection but is actually a single value.

### MR-7: Subprocess result assignment varies
`run X` may return via:
- `the result is ...` (single value)
- `the results are ..., ..., ...` (multiple values)
- No explicit return (then result captured implicitly)

Parser must capture all three forms.

---

## B. Hard Rules — Book/Integration Layer

### MR-8: "(Legacy)" books exist in BOTH catalogs
Some books appear as both a current version AND a "(Legacy)" version (e.g., Salesforce + Salesforce Legacy, Azure Blob Storage + Azure Blob Storage Legacy). The parser must:
- Detect the suffix `(Legacy)` or `-legacy` in book names
- Map to the **current** v2 Integration with a `RE_POINT_TO_CURRENT` flag

### MR-9: SAP / NetSuite / Salesforce require Custom Action discovery
For these three integrations, action names are **tenant-generated** and cannot be statically mapped. The parser must:
- Identify these books in the IR with `CUSTOM_ACTIONS_REQUIRED` flag
- The SOP must include a "Configure Actions → discover → enable services → wait 1–2 min" instruction
- Do NOT attempt to map specific v1 action names to v2 action names for these

### MR-10: Database (Legacy) is MSSQL-only and split in v2
v1 "Database" book = MSSQL only. v2 splits into dedicated **MSSQL** and **Postgres** Integrations. Migration must:
- Default to MSSQL if the v1 process uses Database book
- Flag `DATABASE_SPLIT_DEFAULT_MSSQL` so the user confirms target engine

### MR-11: Excel has two paths in v2
- v1 "Excel Files" (local file ops, built-in) → v2 **Excel** (standalone)
- v1 "Microsoft Excel" (online, Graph) → v2 **Microsoft Excel** (online)

Parser must detect: if procedure uses a file path → local; if uses workbook/sheet name with online context → online.

### MR-12: Custom BDK books need re-deployment
If parser detects `learn from "https://..."`, it must:
- Capture the original endpoint URL
- Flag `CUSTOM_BDK_BOOK_REDEPLOY` with HIGH severity
- SOP must include: re-deploy Docker image → get new HTTPS endpoint → re-learn book

### MR-13: Some v1 books have NO v2 equivalent
Per the Book→Integration catalog, these have no current v2 Integration found:
- Box, Dropbox, Discord, ClickUp, Google Cloud Storage (current), HubSpot, Stripe (current), Microsoft Power BI, Paycom

For each, the parser must:
- Flag `NO_V2_EQUIVALENT` with severity ERROR
- SOP must offer 3 paths: keep legacy book / rebuild via HTTP / use Browser Use

### MR-14: Credentials NEVER transfer
v1 Agent Export excludes credentials. v2 Connections must be re-created. Every Integration in the IR must produce a "Create Connection in v2" checklist item with the correct auth method (from the mapping CSV).

---

## C. Hard Rules — Trigger Layer

### MR-15: Scheduled v1 processes with required inputs are blocked in v2
**v2 constraint:** Automations with required inputs CANNOT be scheduled. The parser must:
- Detect scheduled triggers
- Cross-check whether the process has required inputs (inferred from `ask` calls or undefined references at start)
- If both present, flag `SCHEDULED_WITH_INPUTS` with ERROR severity
- SOP must include redesign instruction (e.g., fetch inputs inside the run, or use webhook/email trigger instead)

### MR-16: Email triggers get new address format
v1 email trigger address format ≠ v2 format (`automation-abc123@us-1.kognitos.com`). Migration cannot preserve the old address; user must update upstream senders.

### MR-17: REST API base URL and auth changed
- v1 API: legacy base URL + API Key header
- v2 API: `rest-api.app.kognitos.com/v2` + `x-api-key` header
- Migration must update any documentation/scripts that call the v1 API

### MR-18: Webhook triggers are NEW in v2
Migration can suggest webhook triggers as an upgrade for event-driven v1 processes that previously polled or used schedule + filter logic.

---

## D. Hard Rules — Subprocess Layer

### MR-19: Parallel subprocess has NO direct v2 equivalent
`start a run where ... / wait for the runs / get the runs's results` must be flagged `PARALLEL_SUBPROCESS_NO_EQUIVALENT` with ERROR severity. The SOP must include:
- Note: "v2 has no direct equivalent for parallel subprocess execution"
- Suggested approaches:
  1. Convert to separate Automation invoked via API for each item
  2. Process sequentially in v2 (may be slower)
  3. Use a workflow orchestration layer outside Kognitos

### MR-20: Subprocess names must follow v1 naming rules in source
v1 process names must start with `to` or end with `is`/`if`/`are`. If a `run X` references a name that doesn't follow this rule, it's a malformed v1 process. Parser flags `INVALID_SUBPROCESS_NAME` as warning.

### MR-21: Subprocess chains can be deep
If a v1 process calls subprocesses that call subprocesses (>3 levels), parser flags `DEEP_SUBPROCESS_CHAIN` for review. Deep chains in v1 often become unwieldy when re-expressed conversationally in v2.

---

## E. Hard Rules — Exception Handling Layer

### MR-22: `ask` becomes a Guidance Center exception
Every `ask` in v1 becomes a v2 exception with guidance. Parser must capture:
- The question text
- The choices (if `the choices are ...` present)
- The position in the flow

SOP must translate to: "If [condition], pause and ask the user for [X]. Acceptable answers: [choices]."

### MR-23: Learnings don't auto-migrate
v1 Learnings (saved fixes) need to be re-created as v2 Troubleshooting Guide entries. Migration utility produces a checklist; actual entry creation happens in v2 UI.

### MR-24: CBL confidence values may not map directly
v1 CBL uses confidence thresholds (default 95%). v2 IDP uses different parameters. Flag `CBL_CONFIDENCE_REVIEW` if a custom threshold was set.

---

## F. Soft Rules — SOP Quality

### MR-25: Drop the "the" prefix in v2 SOP
v1: `get the customer's email` → v2 SOP: "Get the customer's email" (yes, keep it natural; "the" inside English prose is fine but stop treating it as a data prefix sigil)

### MR-26: Express conditionals as explicit rules
v1: `if the total > 10000 then escalate` → v2 SOP: "When the total exceeds $10,000, escalate the invoice."

### MR-27: Loops become "for each"
v1: `process each invoice as follows` → v2 SOP: "For each invoice, do the following:"

### MR-28: Subprocess calls become inline narrative or sectioned steps
- Short subprocesses → inline ("calculate the total tax by [logic]")
- Long subprocesses → separate section in SOP ("**Sub-task: Calculate Total Tax** [steps]")

### MR-29: Preserve business intent, not v1 syntax
The SOP must explain WHAT to do and WHY, not be a translation of HOW v1 expressed it. The v2 Draft builder uses intent to generate steps.

---

## G. Soft Rules — UI/UX

### MR-30: Flag severity hierarchy
- 🔴 ERROR: requires user decision or manual redesign (e.g., `PARALLEL_SUBPROCESS_NO_EQUIVALENT`, `NO_V2_EQUIVALENT`, `SCHEDULED_WITH_INPUTS`)
- 🟡 WARNING: works but needs review (e.g., `GET_SEMANTIC_PAUSE`, `CUSTOM_BDK_BOOK_REDEPLOY`, `DATABASE_SPLIT_DEFAULT_MSSQL`)
- 🔵 INFO: informational (e.g., `RE_POINT_TO_CURRENT`, `WEBHOOK_TRIGGER_OPPORTUNITY`)

### MR-31: Migration Checklist must be actionable
Every checklist item must:
- Start with a verb (Create, Configure, Enable, Re-deploy, Update)
- Specify the destination (in v2, in Workspace X, in Integration Y)
- Reference the v2 doc URL where helpful

### MR-32: Don't translate jargon-for-jargon
v1 "ask the user" → don't say "raise an exception with choices" in the SOP. Say "pause and ask the user, with these options: X, Y, Z."

---

## H. Catch-All Edge Cases

### MR-33: Empty or malformed v1 source
If input is empty, only whitespace, or contains no parseable v1 constructs, return early with a clear error: "No v1 process detected."

### MR-34: Mixed languages
If v1 source contains non-English text (e.g., Spanish data values), preserve verbatim in IR and SOP. Don't translate.

### MR-35: Comments in v1
v1 supports `#` comments. Parser must skip them but optionally preserve as IR metadata for SOP commentary.

### MR-36: Multiple processes in one file
If a single file contains multiple `to ...` process definitions, parse each separately and produce a separate SOP for each. Output as a multi-tab UI panel.

### MR-37: Process referencing itself (recursion)
v1 supports recursive process calls. Parser flags `RECURSIVE_PROCESS` for human review; recursion patterns may need redesign in v2.

### MR-38: Time zones in schedules
v1 schedule timezone defaults to agent's timezone. v2 schedule requires explicit timezone. SOP must ask user to confirm timezone.

### MR-39: Department Box references
v1 "Department Box" is a built-in storage. If referenced, flag `DEPARTMENT_BOX_REVIEW` — v2 may surface this differently (likely as Workspace storage or via OpenSearch migration path).

### MR-40: Ask Koncierge → IDP
v1 `Ask Koncierge` (LLM extraction) maps to v2 **IDP**. Parser detects and remaps. Verbs change: v1 "ask koncierge to extract X" → v2 "Extract X using IDP."

---

## I. Decision Defaults

When the migration utility encounters ambiguity, default behaviors:

| Ambiguity | Default | Override |
|---|---|---|
| Database (Legacy) target engine | MSSQL | User selects Postgres |
| Excel local vs online | Local (Excel standalone) | User selects Microsoft Excel |
| Subprocess flattening | Inline if <5 steps | User selects "keep as separate Automation" |
| Schedule timezone | UTC | User selects timezone |
| Connection environment | Production | User selects Test |
| HubSpot/Stripe/Power BI/Paycom path | Keep legacy book | User selects HTTP rebuild |

---

## J. Validation Gates (before declaring a process "migrated")

Before marking a process as successfully migrated:
1. ✅ All v1 books mapped or flagged as Manual
2. ✅ All Connections created in v2 with credentials
3. ✅ All Custom Actions discovered (for SAP/NetSuite/Salesforce)
4. ✅ All Custom BDK books re-deployed and re-learned
5. ✅ All triggers reconfigured (scheduled inputs check passed)
6. ✅ All parallel subprocesses redesigned
7. ✅ Test run successful on representative inputs
8. ✅ Learnings re-created as Troubleshooting Guide entries

---

## K. HAR-Specific Rules (Phase 0.5)

### MR-41: HAR sanitization is mandatory and runs first
Before ANY processing of an uploaded HAR, run the sanitizer. It strips:
- All `Authorization`, `Cookie`, `X-Api-Key`, `X-Auth-Token` headers
- All `Set-Cookie` response headers
- All query string auth params (`token`, `access_token`, `api_key`)
- All entries to non-Kognitos hosts (analytics, ads, etc.)

This must be **server-side** and tested. Failure to sanitize is a security incident.

### MR-42: Prefer Published over Draft when both present
The `procedureGroup` GraphQL response returns both `draftProcedure` and `publishedProcedure`. If both have non-null `text`, use the **published** version (it's what's actually running). If only one has text, use it. Note the choice in extraction warnings.

### MR-43: Missing subprocess references are warnings, not errors
If a parent process references a subprocess via `@{...}` but that ID isn't in the HAR bundle, emit a `MISSING_SUBPROCESS_IN_HAR` warning. The user can re-capture the HAR after scrolling through more processes. Don't fail extraction.

### MR-44: Topological order for migration
The agent must migrate processes in topological order — **leaves first**, roots last. This ensures when a parent references a child by name in its SOP, the child Automation already exists in v2.

If cycles exist (recursive processes), break the cycle: migrate the cycle nodes individually with a flag that they reference each other, and let the human resolve the ordering manually.

### MR-45: HAR may be partial
A HAR file represents what the user clicked through. If the user didn't open every process in v1, some will be missing. The extractor must:
- Cross-reference `listProcedureGroupsByDepartment` (which lists ALL processes) with `procedureGroup` calls (which have full text)
- Warn if processes are listed but text is missing
- Allow user to upload an additional HAR to fill gaps (HAR merge, future)

### MR-46: Department ID = v1 Agent ID
The `departmentId` field in v1 GraphQL responses is the v1 "agent" identifier. Capture it for the migration report and use it as the bundle's identifying scope.

### MR-47: Process IDs are stable across stages
A v1 process has the same ID in DRAFT and PUBLISHED stages (verified). Use this for deduplication when both stages are present in the HAR.

### MR-48: Owner emails are PII
The `owner` field contains email addresses. Mark these as PII in the report; consider redaction in shared exports.
