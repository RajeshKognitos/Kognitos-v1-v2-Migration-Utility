# Glossary — Kognitos v1 ↔ v2 Terminology

> Quick lookup for every term used across both platforms. When writing parser code, SOP text, or UI copy, use the **v2 term** in user-facing output unless explicitly representing v1 source.

---

## Primary Term Mapping

| v1 Term | v2 Term | Definition (v2) |
|---|---|---|
| Agent | **Workspace** | Team/project container for automations, users, roles, connections |
| Playground | **Draft** | Conversational builder workspace for an in-progress automation |
| Process | **Automation** | Published, locked, versioned workflow |
| Procedure | **Action** (when from a Book) / **Step** (when authored) | Single capability or generated step |
| Book | **Integration** | Collection of Actions for a specific service or capability |
| Book credentials | **Connection** | Reusable, environment-scoped credential set |
| First Edition Book | (no distinction) | Unified into Integrations |
| BDK Book | (no distinction) | Unified into Integrations; custom BDK still uses BDK packaging |
| Exception Center | **Guidance Center** | Centralized exception management with bulk resolution |
| Question (exception) | **Exception** (typed) | Categorized as System / Configuration / Value / Validation |
| Learning | **Troubleshooting Guide entry** | Saved fix that auto-applies to recurring exceptions |
| CBL (Context Based Learning) | (built into IDP) | Auto-classification of document types |
| HAL / Auto-Write | (built into Draft) | Conversational generation of steps |
| KAIA | **Run Assistant** / **Draft Builder** | Help chat |
| Department | (subsumed by Workspace settings) | Scope unit for settings |
| Run | **Run** | Single execution; v2 adds Completed/Processing/Waiting/Failed statuses + archive |
| Mini-Playground | (no direct equivalent) | Used for exception resolution in v1; v2 uses Guidance Center guidance |
| Process Run Widget | (no equivalent) | UI helper for `run /Process`; absent in v2 |

---

## Concepts New in v2

| Term | Definition |
|---|---|
| **Organization** | Top-level account/company entity above Workspaces |
| **Workspace** | Team/project container (replaces Agent) |
| **Connection** | Reusable, environment-scoped credential set |
| **Action** | A single capability exposed by an Integration |
| **Custom Action** | Per-tenant generated action discovered from integrations like SAP/NetSuite/Salesforce |
| **Neurosymbolizing** | The v2 step where Kognitos generates executable steps from your description |
| **Inputs & Triggers** | Configuration panel for what an automation accepts and how it's triggered |
| **Action Item** | Grouped collection of similar exceptions across runs in the Guidance Center |
| **Troubleshooting Guide** | Saved exception resolution that auto-applies |
| **IDP** (Intelligent Document Processing) | First-class integration for document extraction |
| **Browser Use** | NL web automation integration |
| **MCP Server** | Integration enabling AI clients (Claude, etc.) to connect to Kognitos |
| **Test Environment / Production Environment** | Per-Connection environment toggle |
| **Webhook Trigger** | Event-driven trigger from a connected integration |
| **STP** (Straight-Through Processing) | Auto-completion metric in Guidance Center |
| **MTTR** | Mean Time To Resolution metric |
| **Exception Rate** | % of runs that hit exceptions |

---

## Concepts Removed in v2 (or replaced)

| v1 Term | What Replaces It |
|---|---|
| Agent | Workspace |
| Playground | Draft (conversational) |
| Procedure (as authoring unit) | Conversational description → generated Step |
| First Edition Book / BDK Book distinction | Unified Integrations |
| Exception Center | Guidance Center |
| Learning | Troubleshooting Guide entry |
| HAL / Auto-Write toggle | Always-on conversational builder |
| KAIA | Run Assistant / Draft Builder |
| Mini-Playground | Guidance Center resolution flow |
| Process Run Widget | (no equivalent) |
| Department | Workspace settings |
| Process naming constraint (`to…`/`…if/is/are`) | Free-form naming |
| Agent Export/Import (.json) | SOP-based migration (this utility) |
| Performance Dashboard (legacy) | Guidance Center metrics |

---

## v1 Keyword Glossary (for parser)

| Keyword | Meaning | v1 Behavior |
|---|---|---|
| `the` | Prefix for all data names | Required |
| `get` | Retrieve data | **Pauses on missing (Question)** |
| `find` | Retrieve data | **Continues on missing (returns "Not Found")** |
| `use X as the Y` | Reference copy assignment | Y references same value as X |
| `set the X to Y` | Value assignment | Replaces X's value |
| `the X is Y` | Initial definition | Creates new variable |
| `say` | Log/output | Outputs to run log |
| `stop` | Halt run | Terminates execution |
| `imagine` | Placeholder | Declares variable without value |
| `ask` | Custom exception | Pauses run, prompts user |
| `the choices are ...` | Modifies `ask` | Limits answer to listed choices |
| `the above` | Previous line's value | Inline reference |
| `contains` | Membership / filter | `where X contains Y` |
| `add` | Arithmetic OR aggregation | Context-dependent |
| `remove` | Removal | From collection |
| `convert` | Type conversion | "convert X to text" |
| `process each X as follows` | Loop | Iterates over collection |
| `if ... then ... else` | Conditional | Indentation-sensitive blocks |
| `run` | Sequential subprocess call (captures result) | `the result is ...` returns value |
| `invoke` | Sequential subprocess call (fire-and-forget) | No result captured |
| `start a run where` | Parallel subprocess call | Used with `wait for the runs` |
| `wait for the runs` | Sync point for parallel runs | Blocks until all complete |
| `the result is X` | Subprocess return | Single value |
| `the results are X, Y` | Subprocess return | Multiple values |
| `learn from "URL"` | Custom BDK book load | Places endpoint at automation start |

---

## v2 UI Glossary (for SOP output)

When writing v2 SOPs, prefer this vocabulary:

| Use this | Not this |
|---|---|
| "Create a Connection" | "Install a book", "Add credentials" |
| "Configure Actions" | "Set up procedures" |
| "Publish the Automation" | "Publish the agent", "Publish the process" |
| "Edit as Draft" | "Open the playground" |
| "Run the Automation" | "Run the process" |
| "View in Guidance Center" | "Check the Exception Center" |
| "Add a Webhook trigger" | n/a (new in v2) |
| "In your Workspace" | "In your agent" |
| "Test Environment" / "Production Environment" | n/a (new in v2) |

---

## File Format & API Glossary

| Term | Definition |
|---|---|
| v1 Process source | Plain text or `.txt`/`.md` containing the DSL |
| v1 Agent Export | `.json` file from Legacy Export Agent feature |
| Analyzer | LLM-based component (`src/lib/analyzer/`) that converts v1 process source into `V1ProcessIR`. Replaces the traditional hand-written parser. See `14-analyzer-spec.md`. |
| JSON mode | OpenAI feature that guarantees valid JSON output from the model (`response_format: { type: 'json_object' }`); used by the Analyzer. |
| IR (Intermediate Representation) | JSON structure (`V1ProcessIR`) output by our analyzer |
| SOP (Standard Operating Procedure) | Natural language v2-ready document |
| Migration Checklist | Actionable items the user must do in v2 after migrating |
| REST API v2 | Base URL `rest-api.app.kognitos.com/v2`; `x-api-key` header |
| REST API v1 | Legacy v1 REST API (out of scope for migration tool) |
