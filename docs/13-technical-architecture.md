# Technical Architecture — Kognitos v1→v2 Migration Utility

> The consolidated technical plan. The single source of truth for **what we are building**, **how it fits together**, and **what each component does**.

---

## 1. The Story in One Diagram

```
   ┌────────────────────────────────────────────────────────────────────┐
   │                                                                     │
   │   USER                                                              │
   │     │                                                               │
   │     ▼  uploads HAR captured from v1 Kognitos UI                     │
   │                                                                     │
   │   ┌─────────────────────────────────────────────────────────────┐  │
   │   │  HAR EXTRACTOR  (Phase 0.5)                                  │  │
   │   │  - Sanitizes auth tokens                                     │  │
   │   │  - Extracts all v1 processes (GraphQL responses)             │  │
   │   │  - Builds call graph from inline subprocess refs             │  │
   │   │  - Emits ExtractedAgentBundle                                │  │
   │   └────────────────────┬────────────────────────────────────────┘  │
   │                        │                                            │
   │                        ▼  bundle of v1 process source + graph       │
   │                                                                     │
   │   ┌─────────────────────────────────────────────────────────────┐  │
   │   │  PROCESS ANALYZER  (Phase 1) — OpenAI GPT-4o — per process   │  │
   │   │  - LLM analysis in JSON mode + Zod validation + 1 retry      │  │
   │   │  - Builds IR (V1ProcessIR) directly from raw source          │  │
   │   │  - Captures procedures, conditionals, loops, subprocess,     │  │
   │   │    book usages, triggers, exceptions                         │  │
   │   │  - Emits flags per migration rules (MR-2/MR-19/MR-43)        │  │
   │   │  - Book→integration mapping context folded into the prompt   │  │
   │   │  - Deterministic metadata stamping (provenance)              │  │
   │   └────────────────────┬────────────────────────────────────────┘  │
   │                        │                                            │
   │                        ▼  V1ProcessIR (typed JSON)                  │
   │                                                                     │
   │   ┌─────────────────────────────────────────────────────────────┐  │
   │   │  SOP + TEST PLAN GENERATOR  (Phase 3 — Claude API)           │  │
   │   │  - Converts IR + call graph into v2-ready NL SOP             │  │
   │   │  - Generates structured test plan (TestPlan JSON)            │  │
   │   │  - Generates connection checklist                            │  │
   │   └────────────────────┬────────────────────────────────────────┘  │
   │                        │                                            │
   │                        ▼  SOP + TestPlan + Connection checklist     │
   │                                                                     │
   │   ┌─────────────────────────────────────────────────────────────┐  │
   │   │  CONNECTION SETUP UI  (Phase 4 — human in the loop)          │  │
   │   │  - Lists required v2 Connections                             │  │
   │   │  - User clicks through v2 OAuth flows                        │  │
   │   │  - Utility verifies each Connection exists via REST API      │  │
   │   │  - For SAP/NetSuite/Salesforce: trigger Custom Actions       │  │
   │   │    discovery, wait 1-2 min                                   │  │
   │   └────────────────────┬────────────────────────────────────────┘  │
   │                        │                                            │
   │                        ▼  green-lit for autonomous run              │
   │                                                                     │
   │   ┌─────────────────────────────────────────────────────────────┐  │
   │   │  AUTONOMOUS AGENT  (Phase 5 — XState machine)                │  │
   │   │  - Per process, in topological order (leaves first):         │  │
   │   │    1. kognitos_create_automation (MCP) with SOP              │  │
   │   │    2. Drive clarifying conversation via thread mgmt          │  │
   │   │    3. Verify input_specs match expected                      │  │
   │   │    4. Run tests with TestPlan inputs                         │  │
   │   │    5. If exception → kognitos_reply_to_exception             │  │
   │   │    6. Publish via kognitos_manage_automation:publish         │  │
   │   │  - Persists state across serverless invocations              │  │
   │   └────────────────────┬────────────────────────────────────────┘  │
   │                        │                                            │
   │                        ▼  v2 Automation IDs + run results           │
   │                                                                     │
   │   ┌─────────────────────────────────────────────────────────────┐  │
   │   │  REPORT GENERATOR  (Phase 6)                                 │  │
   │   │  - Aggregates timelines, test results, exceptions, costs     │  │
   │   │  - Renders JSON + Markdown + HTML report                     │  │
   │   │  - Provides deep links to v2 Automations + runs              │  │
   │   └─────────────────────────────────────────────────────────────┘  │
   │                                                                     │
   └────────────────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack — Final Decisions


| Layer                          | Choice                           | Why                                                          |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------ |
| Frontend framework             | Next.js 15 (App Router)          | Vercel-native; SSR + serverless                              |
| Language                       | TypeScript (strict)              | Type safety across pipeline                                  |
| UI                             | React + Tailwind CSS             | Standard, fast                                               |
| State machine                  | XState v5                        | Explicit, visualizable, persistable agent FSM                |
| Validation                     | Zod                              | Schema validation at API boundaries + analyzer IR output     |
| AI (Process Analyzer, Phase 1) | OpenAI GPT-4o (JSON mode)        | Structural v1 source → IR; provider-agnostic, had OpenAI key |
| AI (SOP + Test Plan, Phase 3)  | Anthropic Claude API (Sonnet 4)  | Best-in-class for structured text generation                 |
| Kognitos MCP client            | `@modelcontextprotocol/sdk` (TS) | Official SDK                                                 |
| Kognitos REST client           | Custom fetch wrapper             | No official SDK exists                                       |
| Persistence (prod)             | Vercel KV (Redis-compatible)     | Vercel-native, low-latency                                   |
| Persistence (dev)              | better-sqlite3                   | Zero-config local                                            |
| File storage                   | Vercel Blob                      | Temporary HAR / sample file storage                          |
| Testing                        | Vitest + Playwright              | Vitest for units, Playwright for UI flows                    |
| Deployment                     | Vercel                           | One-click, env var support                                   |
| CI                             | GitHub Actions                   | Standard                                                     |
| Logging                        | Pino                             | Structured JSON logs                                         |


---

## 3. Component Inventory

### 3.1 HAR Extractor — `src/lib/har/`

**Inputs:** Raw HAR file content (JSON string)
**Outputs:** `ExtractedAgentBundle`
**Files:**

- `sanitizer.ts` — strips auth, drops non-Kognitos entries
- `extractor.ts` — parses GraphQL responses, extracts procedures
- `call-graph.ts` — builds topological graph from subprocess refs
- `book-detector.ts` — naive book detection via text patterns
- `types.ts` — `ExtractedAgentBundle`, `ExtractedProcess`, `CallGraph`

### 3.2 Process Analyzer — `src/lib/analyzer/`

**Inputs:** `ExtractedProcess.text` (one process) + `CallGraphContext`
**Outputs:** `V1ProcessIR` (validated)
**Approach:** OpenAI (GPT-4o) in JSON mode → Zod validation → ONE corrective retry → deterministic metadata stamping. Replaces the deprecated hand-written parser + mapping enricher (book→integration mapping context is folded into the prompt). See `14-analyzer-spec.md`.
**Files:**

- `prompt.ts` — `buildSystemPrompt()` (inline IR schema + detection/MR rules) + `buildUserPrompt()` (source + call-graph context); `CallGraphContext` type
- `client.ts` — `analyzeProcess()` orchestration: OpenAI call, JSON extraction, validate, retry, `stampMetadata()`; `AnalyzerError`, `ANALYZER_VERSION`
- `schema.ts` — `V1ProcessIRSchema` Zod schema (kept structurally identical to `@/types/ir`)
- `index.ts` — public exports (`analyzeProcess`, schema, prompt builders)

The canonical IR types live in `src/types/ir.ts`.

### 3.3 SOP + Test Plan Generator — `src/lib/sop/`

**Inputs:** Enriched `V1ProcessIR` + `CallGraph`
**Outputs:** `{ sop: string, testPlan: TestPlan, connectionChecklist: ConnectionRequirement[] }`
**Files:**

- `prompts/sop.ts` — SOP generation prompt template
- `prompts/test-plan.ts` — test plan generation prompt template
- `claude-client.ts` — Anthropic API wrapper with retries
- `generator.ts` — orchestrates SOP → test plan generation
- `validator.ts` — Zod validation of Claude outputs

### 3.4 Kognitos API Client — `src/lib/kognitos/`

**Inputs:** API calls
**Outputs:** Typed responses
**Files:**

- `mcp-client.ts` — MCP server wrapper (OAuth + tool invocation)
- `rest-client.ts` — REST API wrapper (Bearer auth)
- `polling.ts` — polling helpers with exponential backoff
- `types.ts` — Automation, Run, Exception, Connection types from OpenAPI
- `index.ts` — `KognitosClient` unified facade

### 3.5 Agent — `src/lib/agent/`

**Inputs:** Enriched IR + SOP + TestPlan + KognitosClient
**Outputs:** Migration result (automation IDs, test results, exceptions handled)
**Files:**

- `machines/migration.ts` — XState machine (per process)
- `machines/orchestrator.ts` — coordinator across multiple processes (topological)
- `steps/create-automation.ts` — invokes `kognitos_create_automation`
- `steps/clarify.ts` — handles thread messages
- `steps/run-test.ts` — invokes runs + polls
- `steps/resolve-exception.ts` — uses Claude + `kognitos_reply_to_exception`
- `steps/publish.ts` — publishes the automation
- `persistence.ts` — KV/SQLite state persistence
- `events.ts` — emits timeline events for the report

### 3.6 Report Generator — `src/lib/report/`

**Inputs:** Agent timeline + IR + test results + automation IDs
**Outputs:** `MigrationReport` (JSON, Markdown, HTML)
**Files:**

- `aggregator.ts` — collects data from agent persistence
- `json-renderer.ts` — serializes to JSON
- `markdown-renderer.ts` — generates `.md`
- `html-renderer.tsx` — React component for in-app view
- `insights.ts` — computes aggregate metrics

### 3.7 API Routes — `src/app/api/`

**Endpoints:**

- `POST /api/upload-har` — upload + sanitize + extract
- `POST /api/parse` — IR generation for a process
- `POST /api/enrich` — mapping enrichment
- `POST /api/generate-sop` — SOP + test plan + connection checklist
- `GET /api/connections/required/:bundleId` — required connections
- `POST /api/connections/verify` — check that a Connection exists in v2
- `POST /api/agent/start` — kick off migration agent for a bundle
- `GET /api/agent/status/:migrationId` — current state + timeline
- `POST /api/agent/intervene/:migrationId` — human override
- `GET /api/report/:reportId` — JSON report
- `GET /api/report/:reportId.md` — Markdown report

### 3.8 UI — `src/app/(ui)/`

**Routes:**

- `/` — Dashboard (recent migrations, upload entry)
- `/upload` — HAR upload + extracted bundle preview + call graph
- `/migration/:id` — Live migration view (agent state, timeline)
- `/migration/:id/review` — Human review/intervention UI
- `/report/:id` — Migration report view
- `/connections` — Connection management
- `/settings` — Workspace config (PAT, org/workspace IDs)

---

## 4. Data Flow End-to-End

```
[ 1. UPLOAD ]
User → POST /api/upload-har (multipart) → Server
  → Sanitize HAR (strip auth tokens, drop non-Kognitos entries)
  → Persist sanitized HAR to Vercel Blob
  → Run HAR Extractor → ExtractedAgentBundle
  → Persist bundle to KV (key: bundleId)
  → Return bundleId + summary (process count, call graph, warnings)

[ 2. ENRICH ]
User → POST /api/parse + /api/enrich per process → Server
  → Load bundle from KV
  → For each process: parse → enriched IR
  → Persist enriched IRs to KV (key: bundleId:ir:processId)

[ 3. GENERATE ]
User → POST /api/generate-sop with bundleId → Server (background job)
  → For each process: call Claude → SOP + TestPlan
  → Aggregate Connection requirements
  → Persist SOPs to KV (key: bundleId:sop:processId)
  → Return progress via SSE or polling

[ 4. CONNECT ]
User → GET /api/connections/required/:bundleId → Server
  → Return list of required Connections (deduplicated across processes)
User → manually creates Connections in v2 UI
User → POST /api/connections/verify with each Connection name → Server
  → REST call to v2: list connections in workspace
  → Return verified status
[ Repeat until all green ]

[ 5. AGENT ]
User → POST /api/agent/start with bundleId → Server
  → Create migrationId (UUID)
  → Topologically sort processes (leaves first)
  → Spawn XState machine per process (or sequentially)
  → Each machine:
     - kognitos_create_automation
     - Handle clarifications
     - Run TestPlan cases
     - Resolve exceptions
     - Publish
     - Emit timeline events to KV
  → Return migrationId

User → GET /api/agent/status/:migrationId (poll or SSE) → Server
  → Return current state + recent events

[ 6. REPORT ]
On migration completion (all machines reach `done` or `escalate_to_human`):
  → Aggregate timeline + automation IDs + test results
  → Generate MigrationReport JSON
  → Persist to KV (key: report:reportId)
  → UI navigates to /report/:reportId
```

---

## 5. Persistence Schema

### Vercel KV (production)

```
KEY                                    VALUE
bundle:<bundleId>                      ExtractedAgentBundle (JSON)
bundle:<bundleId>:ir:<processId>       V1ProcessIR (JSON)
bundle:<bundleId>:sop:<processId>      { sop, testPlan, connectionChecklist }
migration:<migrationId>                AgentInstance (top-level state)
migration:<migrationId>:process:<pid>  Per-process machine state + timeline
report:<reportId>                      MigrationReport (JSON)
config:user:<userId>                   { kognitosPat, orgId, workspaceId } (encrypted)
```

TTL on bundle/migration data: 30 days. Reports persist indefinitely.

### Local dev (better-sqlite3)

Same schema; mapped to SQLite tables with JSON columns.

---

## 6. Phased Build Plan (Updated)

### Phase 0 — Project Setup (Day 1)

- Next.js 15 + TS + Tailwind scaffolded
- `.env.example` with all required vars
- Vercel deployment config
- Basic dashboard page (placeholder)

### Phase 0.5 — HAR Extractor (Days 2-3) ⭐ NEW

- `src/lib/har/` module complete
- Sanitization tested against real HAR (security audit)
- Extractor tested against sample HAR (7-process VHD)
- Call graph construction with cycle detection
- Integration tests using anonymized sample HARs

### Phase 1 — Process Analyzer (LLM-based) (Day 4) ⭐ NEW

- `src/lib/analyzer/` complete per `14-analyzer-spec.md`
- OpenAI (GPT-4o) + JSON mode + Zod validation + ONE corrective retry
- Deterministic metadata stamping; reuses IR types in `src/types/ir.ts`
- A thin orchestrator iterates the bundle's processes through `analyzeProcess()`
- Book→integration mapping context folded into the prompt (no standalone enricher)
- Integration tests on golden fixtures (schema conformance + key flags)
- Collapses the original parser (~~3 days) + mapping enricher (~~1 day) into ~1 day

### Phase 3 — SOP + Test Plan Generator (Days 8-10)

- `src/lib/sop/` complete
- Claude prompts tuned + Zod validation
- 5+ golden examples (input IR → expected SOP)
- Connection checklist generation

### Phase 4 — Connection Setup UI (Days 11-12)

- `src/app/connections/` UI
- v2 REST integration for Connection verification
- Custom Actions discovery flow for SAP/NetSuite/Salesforce
- Status dashboard

### Phase 5 — Agent (Days 13-18)

- KognitosClient (MCP + REST) complete
- XState machine implemented per `09-autonomous-build-loop.md`
- All step actors implemented
- Persistence layer
- Live status streaming (SSE)
- Tested end-to-end on sample HAR processes

### Phase 6 — Report (Days 19-20)

- Report generator complete
- All three formats (JSON/MD/HTML)
- Insights computation

### Phase 7 — Polish + Testing (Days 21-25)

- E2E Playwright tests
- Performance tuning
- UX polish
- Documentation
- Deployment runbook

**Total estimated: ~~3 weeks (~~15 working days)**

The LLM analyzer collapsed Phases 1 and 2 into a single ~1-day orchestrator step, trimming the original ~5-week estimate to ~3 weeks. MVP (Phases 0-3) lands in ~8 days.

---

## 7. Critical Risks & Mitigations


| Risk                                                           | Likelihood | Impact | Mitigation                                                               |
| -------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------ |
| Kognitos GraphQL schema changes (HAR extractor breaks)         | Medium     | High   | Pin to observed schema; integration tests; version-aware extractor       |
| LLM output drift (analyzer IR varies across model versions)    | Medium     | Medium | Zod validation + integration tests on golden fixtures                    |
| MCP `kognitos_create_automation` produces poor SOPs            | Medium     | High   | Phase 3 SOP refinement; few-shot examples; retry with corrective prompts |
| Custom Actions discovery doesn't complete                      | Low        | Medium | Polling with 5-min timeout; escalate to human                            |
| OAuth flows can't be automated for some integrations           | High       | Low    | Human-in-loop (Phase 4) by design                                        |
| HAR contains real PII                                          | High       | High   | Aggressive sanitization; flag sensitive content; opt-in storage          |
| Claude API rate limits / costs                                 | Medium     | Medium | Caching; reuse generated SOPs for same input; cost tracking in report    |
| v2 API rate limits                                             | Medium     | Medium | Client-side throttling; exponential backoff; respect 429                 |
| Long-running agent exceeds serverless timeout                  | High       | Medium | Persistent state; resume from KV; chunk into multiple invocations        |
| Subprocess parallelism (v1 `start a run`) has no v2 equivalent | High       | Low    | Flag in IR; SOP includes redesign; escalate if user wants exact parity   |


---

## 8. Environment Variables

```bash
# .env.example
# === Process Analyzer (Phase 1) ===
OPENAI_API_KEY=sk-...                  # required by src/lib/analyzer (GPT-4o)

# === Claude (SOP + Test Plan, Phase 3) ===
ANTHROPIC_API_KEY=sk-ant-...

# === Kognitos v2 ===
KOGNITOS_PAT=...                       # Personal Access Token
KOGNITOS_ORG_ID=...                    # Default org for migrations
KOGNITOS_WORKSPACE_ID=...              # Default workspace
KOGNITOS_MCP_URL=https://mcp.us-1.kognitos.com/
KOGNITOS_API_BASE=https://app.us-1.kognitos.com

# === Persistence ===
KV_URL=...                             # Vercel KV (prod) - leave empty for SQLite (dev)
KV_REST_API_URL=...
KV_REST_API_TOKEN=...

# === Storage ===
BLOB_READ_WRITE_TOKEN=...              # Vercel Blob for HAR files

# === App ===
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

---

## 9. Security Considerations

1. **PATs encrypted at rest.** Use AES-256-GCM via a server-side key (env var). Never log.
2. **HAR sanitization is mandatory.** Test must verify no auth headers persist to storage.
3. **Sandboxed Claude API calls.** Input/output never include user credentials.
4. **CSP headers** on all pages. No inline scripts beyond Next.js essentials.
5. **Audit log.** Every API call to v2 (writes especially) logged with `migrationId` for traceability.
6. **Internal only.** No public auth flow; gated behind company SSO (deferred — internal tool, network-restricted is acceptable for MVP).

---

## 10. Success Criteria (Definition of Done)

The utility is "done" (for V1.0) when:

- ✅ User uploads HAR → sees extracted bundle within 30 seconds
- ✅ Parser successfully IR-generates 95%+ of real v1 processes (measured on a corpus)
- ✅ Generated SOPs cause Kognitos `kognitos_create_automation` to succeed without manual edits in 80%+ of cases
- ✅ Test plans cover 1+ happy path + 1+ edge case per process
- ✅ Agent successfully publishes a v2 Automation in 70%+ of attempts (rest escalate cleanly to human)
- ✅ Exception resolution loop succeeds in 60%+ of exceptions encountered
- ✅ Migration report contains all required sections per spec 11
- ✅ End-to-end migration of a 7-process bundle completes in under 30 minutes
- ✅ No PII leaks to logs, storage, or reports

---

## 11. What's Out of Scope (V1.0)

- ❌ Customer-facing UI (internal only)
- ❌ Real-time bidirectional v1↔v2 sync
- ❌ Reverse migration (v2 → v1)
- ❌ Running v1 processes (we don't execute v1)
- ❌ Bulk multi-agent migration UI (one agent at a time)
- ❌ HAR diff mode (re-migrate only changed processes)
- ❌ Auto-discovery of HAR via browser extension
- ❌ Multi-tenant SaaS

These are V2.0+ candidates.

---

## 12. The "TL;DR for Cursor"

When opening any Cursor chat for this project, the mental model is:

> **HAR in → process bundle → parsed IR → SOP/test plan → human OAuth setup → autonomous agent builds v2 → report out.**
>
> Built as Next.js + TS + Tailwind on Vercel. State machine for the agent (XState). Claude for SOP gen. MCP + REST for Kognitos v2 control. Persistence in Vercel KV. Phase-by-phase build over ~5 weeks.

This document, the project brief (`01-project-brief.md`), and the specific phase doc you're working in are the three things to load into Cursor's context.