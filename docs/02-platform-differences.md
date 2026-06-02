# Platform Differences Reference — Kognitos v1 (Legacy) vs v2 (Current)

> Canonical reference for all v1 vs v2 platform behavior. When in doubt, this doc wins over the project brief on platform questions.

---

## 1. Architectural Model

### v1 (Legacy)
- **Agent** = dedicated execution environment containing automations, books, settings
- **Playground** = free-text editor for writing/testing procedures
- **Process** = formalized automation, has stages: Draft Process → Published Process
- **Books** = sets of related procedures (integrations or capabilities)
- **HAL / Auto-Write** = optional AI assist in the editor
- **KAIA** = help assistant (bottom-left)

### v2 (Current)
- **Organization** = company/account top level
- **Workspace** = team/project container (replaces Agent); has users, roles, automations, connections
- **Automation** = published, versioned workflow (replaces Process)
- **Draft** = conversational builder workspace (replaces Playground)
- **Integration** = collection of Actions (replaces Book)
- **Connection** = reusable, secure credential set with Test/Production env
- **Action** = single capability from an Integration (replaces Procedure where it came from a Book)
- **Guidance Center** = exception management (replaces Exception Center)
- **Troubleshooting Guide** = saved fixes (replaces Learnings)
- **Neurosymbolizing** = v2's branded term for the AI generating executable steps from your description

### Implication
The v2 model adds a layer (Organization), renames the container (Agent → Workspace), splits credentials into their own first-class object (Connection), and **fundamentally changes the authoring UX** from "write procedures" to "describe and refine."

---

## 2. Authoring Model

### v1: Write Procedures
User types plain-English DSL into the Playground editor. Example:
```
process each invoice as follows
  extract data from the invoice where
    the first field is "invoice number"
    the first field's format is "text"
  if the total > 10000 then
    send an email where
      the recipient is "approvals@company.com"
      the subject is "Approval needed"
```

### v2: Describe and Refine
User chats with Kognitos in a Draft. Example:
> "I want to process invoices from a folder. For each invoice, extract the invoice number. If the total is over $10,000, send an approval email."

Kognitos asks clarifying questions ("Which folder?", "Email recipient?") and generates the executable steps. The result is shown as a **Document** (steps) and **Diagram** (flow).

### Implication
v1 source is **parseable, deterministic text**. v2 input is **conversational intent**. The migration utility must treat v1 DSL as **intent specification** to convert into a natural-language SOP, not as code to transpile to code.

---

## 3. Process Lifecycle

### v1: Three Stages
```
Playground → Draft Process → Published Process
```
- Playground: exploratory, free-form
- Draft Process: formalized, named (must follow naming rules — see Section 9)
- Published Process: locked, version-tracked, triggers active

### v2: Two Stages + Monitoring Loop
```
Draft → Publish → Monitor → (Edit as Draft → republish)
```
- Draft: conversational, iterative
- Publish: creates a **locked, major-versioned Automation** (v1.0, v2.0, v3.0)
- Monitor: track runs, manage exceptions in Guidance Center
- In-progress runs **pin** to their starting version
- New runs use the latest version

### Implication
v2 simplifies the lifecycle and makes versioning explicit. Migration must respect v2's major-version semantics.

---

## 4. Books → Integrations

### v1: Two Book Families
- **First Edition Books**: Kognitos-authored standard library (e.g., Salesforce, Email, Database)
- **BDK Books**: Built via Book Development Kit (Python + Docker), e.g., Salesforce BDK, Browser Use BDK

### v1 Install Flow
1. Books → + New Book
2. Search by name
3. Pick version (e.g., one tagged with `bdk`)
4. Supply credentials if required
5. Click Add
6. **Publish the agent** + **create a new Playground** (previously created Playgrounds won't recognize the new Book)

### v2: Unified Integrations Catalog
- All integrations under **Integrations → Explore Integrations**
- Each Integration exposes **Actions**
- Credentials are now a separate object: **Connection**
- Connections have **Test/Production environment** distinction
- One Integration can have **multiple Connections**
- Some Integrations (SAP, NetSuite, Salesforce) have **Custom Actions** that must be **discovered and enabled** (Configure Actions → search/toggle → Save → wait 1–2 min)

### v2 Install Flow
1. Integrations → + New Connection
2. Choose Integration, select auth method
3. Enter credentials, choose Test or Production environment
4. Save
5. (If Custom Actions integration) Configure Actions → discover → enable services
6. No agent publish required; no Playground recreation required

### Implication
- The migration must remap every v1 Book to its v2 Integration
- The migration must guide the user to re-create Connections (credentials don't transfer)
- For SAP/NetSuite/Salesforce, the migration must flag the discovery step
- For custom BDK books, the migration must flag re-deployment

---

## 5. Subprocess / Process Composition

### v1: Three Mechanisms
**1. Run (sequential, captures result):**
```
run calculate the total
  the price is the invoice total
# returns: the result is the calculated total
```

**2. Invoke (sequential, fire-and-forget):**
```
invoke verify applicant qualifications with
  the resume
```

**3. Parallel:**
```
process each invoice as follows
  start a run where
    the procedure is process invoice
    the invoice is the invoice
wait for the runs
get the runs's results as the processed invoices
```

### v2: No Direct Keyword Equivalent
- Composition handled conversationally / by the platform
- Subprocess calls become either:
  - Separate v2 Automations invoked via API/triggers
  - Inlined steps within a single Automation

### Implication
- Sequential `run` and `invoke` are straightforward to flatten into v2 SOP narrative
- **Parallel `start a run` / `wait for the runs` has no direct v2 equivalent** — must be redesigned (flag prominently to the user)

---

## 6. Conditionals, Loops, Data Definitions

### v1: Explicit Indentation-Sensitive Grammar

**Conditionals:**
```
if the total < 10000 then
  approve the invoice
else
  escalate the invoice
```

**Loops:**
```
process each document as follows
  get the document's invoice number
  get the document's fields
```
*(Indentation marks the loop body)*

**Counters:**
```
the counter is 0
process each item as follows
  add 1 to the counter
```

**Data definitions:**
```
the customer is "John Smith"
the total is 1500
the items are ("apple", "banana", "cherry")
```
*(All data names prefixed with "the")*

### v2: Generated From Description
- No user-facing grammar; generated from the conversational description
- Best practice: describe rules explicitly (e.g., "Flag any invoice where total ≠ sum of line items")

### Implication
- v1 conditionals/loops are easy to parse but must be translated to explicit rule statements in the v2 SOP
- "the X" prefix is a v1 convention; drop in v2 NL output

---

## 7. Keywords (v1 Critical Semantics)

| Keyword | v1 Behavior | Migration Note |
|---|---|---|
| `get` | Retrieve; **raises a Question / pauses** if not found | Preserve as explicit exception/guidance note in v2 SOP |
| `find` | Retrieve; **returns "Not Found" and continues** if absent | Express as "look up; if not found, continue" |
| `use X as the Y` | Assign by reference copy | Map to "set Y to X" |
| `set the X to Y` | Assign value | Direct |
| `say` | Output/log | "Log [text]" |
| `stop` | Halt run | "Stop processing" |
| `imagine` | Placeholder declaration | "Assume [X] exists" |
| `ask` | Raise custom exception/question (optionally `the choices are ...`) | Map to Guidance Center action with choices |
| `the above` | Reference previous line's value | Inline expand in v2 SOP |
| `contains` | Membership / table filter | "where X contains Y" |
| `add` | Arithmetic, date math, OR table aggregation (context-dependent) | Disambiguate in v2 SOP based on operand types |
| `remove` | Removal from collection | Direct |
| `convert` | Type conversion | "Convert X to [type]" |

### Implication
The `get` vs `find` distinction is **critical** — same intent, different exception behavior. Must be preserved.

---

## 8. Triggers

### v1 Triggers (per Published Process)
| Trigger | v1 Behavior |
|---|---|
| Schedule | Hourly / daily / weekly intervals |
| Email | Unique address per process; sender permissions; only on Published |
| API | REST API trigger via API Keys (under user icon) |

### v2 Triggers (configured in Draft → Inputs & Triggers)
| Trigger | v2 Behavior |
|---|---|
| Schedule | Every N days/weeks/months, days, start time, timezone; presets: Every 5 min, Hourly, Daily, Every Weekday. **Cannot be used if automation has required inputs.** |
| Email | Unique address like `automation-abc123@us-1.kognitos.com`; optional filters by sender/CC/subject |
| Webhook | Select Integration → Connection → Event (NEW in v2) |
| REST API | v2 base: `rest-api.app.kognitos.com/v2`; `x-api-key` header; POST `/v2/runs` with name, automation, workspace, stage + inputs |

### Implication
- v1 schedule + email + API → v2 schedule + email + API (1:1, but reconfigure)
- v2 adds Webhook trigger (consider for event-driven processes)
- **v1 scheduled processes with required inputs must be redesigned** (v2 blocks this)

---

## 9. Naming Rules

### v1: Strict Process Naming
- Must start with `to` OR end with `is` / `if` / `are`
- Alphanumeric only
- Invalid: "Process Invoices 2024!", "process-invoices"
- Valid: "to process invoices", "the invoice is processed", "process invoice is"

### v2: Naming Handled Conversationally
- No strict rules; user names the Automation freely
- Naming happens through the Draft conversation UI

### Implication
- v1 naming constraint is irrelevant in v2
- Migration can suggest cleaner human-readable names for v2

---

## 10. Exception Handling

### v1: Exception Center
- View/answer exceptions across automations
- Resolve **individually**
- Resolution methods: Choose field, Enter value, Retry, Modify (Mini-Playground), No value needed ("-"), Skip step
- Custom exceptions raised via `ask` (optionally `the choices are ...`)
- Saved fixes = **Learnings**
- **CBL (Context Based Learning)**: auto-classifies document types (default 95% confidence)

### v2: Guidance Center
- Exceptions typed: **System / Configuration / Value / Validation**
- Grouped into **Action Items** by exception type across runs
- **Bulk/group resolution** with natural-language guidance ("Start review")
- Health metrics: Auto-completion (STP), Runs Need Action, Total Completion, Runs This Week, Exception Rate, MTTR
- System Issues handled by Kognitos engineering (no user action)
- Saved resolutions live in **Troubleshooting Guide**, auto-applied to recurring exceptions
- "Try New Flow" toggle: group vs individual handling

### Implication
- v1 Learnings → v2 Troubleshooting Guide entries
- v1 `ask` + `choices` → v2 typed exception + guided resolution
- Express resolution rules generically (by exception type) to exploit bulk resolution

---

## 11. User Roles & Permissions

### v1
- Basic roles, single-tenant per agent

### v2
- Granular: **Account Owner, Org Admin, Workspace Admin, Automation Author, Automation Operator, IT/Integrator, Member, CXO**
- Org-scoped and Workspace-scoped roles

### Implication
- Migration utility does not need to handle roles (out of scope)
- But document that v2 has richer RBAC for the migration runbook

---

## 12. Migration / Import-Export

### v1: Legacy Agent Export
- Export agent as `.json` file
- Contains: published processes, learnings, books
- **Excludes**: drafts, playgrounds, credentials

### v2: No Direct Import of v1 Export
- No official platform-level v1→v2 migration tool
- v2 ingests SOPs via Draft conversation or uploaded process docs

### Implication
- Our migration utility fills this gap
- Use v1 Export as source-of-truth inventory of published processes
- Credentials always need re-entry in v2 Connections

---

## 13. Quick Reference: What Doesn't Exist in v2

v1 concepts removed or replaced in v2:
- "Agent" as a configured container → Workspace
- Playground free-text editor → conversational Draft
- Procedure/keyword grammar as user-editing surface → backend execution substrate only
- `run` / `invoke` / `start a run` keywords → no direct equivalent (compositional restructuring)
- Process Run Widget → no direct equivalent
- Exception Center → Guidance Center
- "First Edition Books" vs "BDK Books" distinction → unified Integrations catalog
- HAL / Auto-Write → Draft conversational builder
- KAIA → Run Assistant / Draft builder
- Department-level settings → Workspace settings
- Process naming rules (`to…`/`…if/is/are`) → free-form naming
- Export/Import Agents → use SOP-based migration
- Enterprise/Performance Dashboard (legacy framing) → reorganized into Guidance Center metrics
- Test Suite (legacy) → reworked

## 14. Quick Reference: New in v2

v2 features that did not exist in v1:
- Organization / Workspace hierarchy
- Granular RBAC (8 named roles)
- Conversational Draft builder + "Neurosymbolizing"
- SOP/process-doc upload to seed Draft
- Run Assistant chat
- Connections as first-class reusable credential objects (Test/Production env, multiple per Integration)
- Custom Actions discovery (SAP, NetSuite, Salesforce)
- Webhook triggers
- Explicit major versioning (v1.0, v2.0...) with in-progress-run version pinning
- Run archiving + explicit statuses (Completed, Processing, Waiting, Failed)
- Guidance Center Action Items, bulk/group resolution, exception type taxonomy
- STP / MTTR / Exception Rate metrics
- Auto-applying Troubleshooting Guide
- Browser / Browser Use (NL web automation) as explicit integrations
- IDP (Intelligent Document Processing) as first-class integration
- MCP Server integration (connect Claude/AI clients to Kognitos)
- REST API v2 surface
- Glossary doc

## 15. Reference URLs

- v1 docs root: https://docs.kognitos.com/legacy
- v2 docs root: https://docs.kognitos.com/guides
- v2 Integrations catalog: https://docs.kognitos.com/books
- v2 BDK docs: https://docs.kognitos.com/books-bdk
- v2 REST API: https://docs.kognitos.com/rest-api
- v2 Glossary: https://docs.kognitos.com/guides/resources/glossary.md
