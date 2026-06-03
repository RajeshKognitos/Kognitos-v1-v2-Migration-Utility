# Kognitos v1→v2 Migration Utility — Master Project Brief

> The spine of the project. **Updated** to reflect the HAR-first input architecture and autonomous agent verified via v2 API research.

---

## 1. Project Overview

### Goal
Build an **internal autonomous migration agent** that ports Kognitos v1 (Legacy) automation processes to v2 (Current) Automations using HAR file capture as the primary input.

### Users
Internal Kognitos team members (FDEs, solution engineers, migration specialists).

### End-State Flow (Autonomous Vision)
1. User captures a HAR file by browsing a v1 agent in Chrome DevTools
2. User uploads HAR → system extracts all processes + call graph + metadata
3. System parses each v1 process to an IR
4. System generates v2-ready SOPs + test plans via Claude
5. Human does **one-time** Connection setup in v2 (OAuth flows)
6. **Engine autonomously**:
   - Creates v2 Automations via Kognitos MCP server
   - Drives clarifying conversations programmatically
   - Runs tests with sample inputs
   - Resolves exceptions via Guidance Center API
   - Iterates until tests pass
   - Publishes the Automations
7. Engine produces an end-state migration report

### Why HAR as Primary Input
Validated on a real HAR file from a 7-process v1 agent:
- Single upload extracts ALL processes with full source code
- Subprocess relationships (parent→child) are preserved via inline procedure IDs
- Call graph reconstructed automatically (no manual mapping)
- Metadata captured: name, owner, version, stage, schedules, last run

Alternative inputs (paste, JSON export) remain as fallbacks.

### Output
A **Next.js web app deployable on Vercel** providing:
- HAR upload + extracted bundle preview with call graph
- Connection management UI (one-time OAuth setup)
- Live agent progress visualization
- Migration report download (JSON/Markdown/HTML)
- Manual override controls

### Tech Stack
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **State machine:** XState v5 for agent orchestration
- **AI layer:** Anthropic Claude API (Sonnet 4) for SOP/test plan generation
- **Kognitos API:** MCP client (`@modelcontextprotocol/sdk`) + custom REST wrapper
- **Persistence:** Vercel KV (prod) / better-sqlite3 (dev)
- **Storage:** Vercel Blob for HAR files
- **Deployment:** Vercel
- **Language:** TypeScript strict throughout

---

## 2. Architecture

```
USER INTERFACE (Next.js)
  - Upload HAR (primary) / paste text / upload JSON export
  - Preview extracted bundle + call graph
  - Configure v2 Connections (one-time per integration)
  - Watch agent progress (live state)
  - Review/override agent decisions
  - Download migration report

PIPELINE LAYER
  HAR Extractor (P0.5) → Process Analyzer (P1, OpenAI GPT-4o + Zod)
    → SOP+Test Plan Generator (P3, Claude) → Agent (P5, MCP+REST)
    → Report Generator (P6)

EXTERNAL APIS
  - Anthropic Claude API (SOP + test plan generation)
  - Kognitos MCP Server (autonomous build via natural language)
  - Kognitos REST API (resource CRUD, runs, exceptions)
```

### Folder Structure (Target)
```
/
├── .cursorrules                  # Cursor project rules
├── /docs/                        # Project knowledge (all the *.md files)
├── /samples/                     # Sample HAR files + extracted bundles
│   ├── agent-bundles/            # Anonymized .har files
│   ├── extracted/                # Expected ExtractedAgentBundle outputs
│   └── processes/                # Individual .txt samples (Tier-2 testing)
├── /public/                      # Static assets
├── /src/
│   ├── /app/                     # Next.js App Router
│   │   ├── /api/
│   │   │   ├── /upload-har/route.ts          # POST → bundle
│   │   │   ├── /parse/route.ts               # POST → IR
│   │   │   ├── /enrich/route.ts              # POST → enriched IR
│   │   │   ├── /generate-sop/route.ts        # POST → SOP + test plan
│   │   │   ├── /connections/required/...     # GET → required Connections
│   │   │   ├── /connections/verify/route.ts  # POST → verify a Connection
│   │   │   ├── /agent/start/route.ts         # POST → kick off agent
│   │   │   ├── /agent/status/[id]/route.ts   # GET → live status
│   │   │   ├── /agent/intervene/...          # POST → human override
│   │   │   └── /report/[id]/route.ts         # GET → migration report
│   │   ├── /(ui)/                # UI routes
│   │   ├── layout.tsx
│   │   └── page.tsx              # Dashboard
│   ├── /lib/
│   │   ├── /har/                 # P0.5 — HAR extraction
│   │   ├── /analyzer/            # P1 — LLM-based v1 source → IR (OpenAI + Zod)
│   │   ├── /sop/                 # P3 — Claude prompts + generation
│   │   ├── /kognitos/            # MCP + REST clients
│   │   ├── /agent/               # P5 — XState machine + steps
│   │   ├── /report/              # P6 — report generation
│   │   └── /storage/             # Persistence (KV/SQLite)
│   ├── /components/              # React components
│   └── /types/                   # Shared TS types (IR, bundle, etc.)
├── /tests/
│   ├── /har/                     # HAR extractor tests
│   ├── /parser/                  # Parser unit tests
│   ├── /agent/                   # Agent step tests
│   └── /fixtures/                # Sample HARs, IRs, mock API responses
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## 3. Phased Build Plan

### Phase 0 — Project Setup (Day 1)
- Next.js + TS + Tailwind scaffolded
- Vercel deployment config
- `.env.example` with all required vars
- Basic dashboard page

### Phase 0.5 — HAR Extractor (Days 2-3) ⭐
- `/src/lib/har/` module per `12-input-specification.md`
- HAR sanitization (security-audited)
- Process + call graph extraction
- Validated against real HAR

### Phase 1 — Process Analyzer (LLM-based) (Day 4)
- `/src/lib/analyzer/` per `14-analyzer-spec.md`
- OpenAI (GPT-4o) + JSON mode + Zod validation + ONE corrective retry
- Deterministic metadata stamping; reuses IR types in `src/types/ir.ts`
- Takes `ExtractedProcess.text` + call-graph context → `V1ProcessIR` directly
- Book→Integration mapping context folded into the analyzer prompt (no separate enricher phase)
- Integration tests on golden fixtures

### Phase 3 — SOP + Test Plan Generator (Days 8-10)
- Claude prompts + Zod validation
- 5+ golden examples
- Connection checklist generation

### Phase 4 — Connection Setup UI (Days 11-12)
- Required Connections derived from IR + mapping
- v2 REST integration for verification
- Custom Actions discovery for SAP/NetSuite/Salesforce

### Phase 5 — Autonomous Agent (Days 13-18)
- KognitosClient (MCP + REST) per `08-v2-api-spec.md`
- XState machine per `09-autonomous-build-loop.md`
- Persistence + resume support
- Live status streaming (SSE)

### Phase 6 — Report Generator (Days 19-20)
- Aggregator + JSON/MD/HTML renderers per `11-end-state-report-format.md`

### Phase 7 — Polish + Testing (Days 21-25)
- E2E tests, performance, UX polish
- Documentation + runbook

**Total: ~3 weeks. MVP (Phases 0-3): ~8 days.**

> The LLM analyzer collapsed the original Phase 1 (parser, ~3 days) and Phase 2 (mapping enricher, ~1 day) into a single ~1-day orchestrator step, trimming the overall estimate from ~5 weeks to ~3 weeks.

---

## 4. Decisions Log

| # | Question | Decision | Date |
|---|---|---|---|
| 1 | Internal only or customer-facing? | Internal only (for now) | Jun 2026 |
| 2 | Tech stack? | Next.js + TS + Tailwind + Vercel | Jun 2026 |
| 3 | IDE? | Cursor | Jun 2026 |
| 4 | Build approach? | Phased: HAR → Parser → SOP → Agent → Report | Jun 2026 |
| 5 | Autonomous architecture confirmed? | YES — MCP `kognitos_create_automation` + REST API supports it | Jun 2026 |
| 6 | **Primary input format?** | **HAR file** (validated on real 7-process HAR) | Jun 2026 |
| 7 | Fallback input formats? | Text paste / JSON export | Jun 2026 |
| 8 | State machine library? | XState v5 | Jun 2026 |
| 9 | Persistence layer? | Vercel KV (prod), better-sqlite3 (dev) | Jun 2026 |
| 10 | Connection OAuth flow handling? | Human-in-loop one-time setup per integration | Jun 2026 |
| 11 | Webhook fallback for run state? | Polling (no webhooks documented) | Jun 2026 |
| 12 | HAR sanitization scope? | Strip ALL auth headers + drop non-Kognitos entries | Jun 2026 |
| 13 | Parser approach? | Replaced hand-written parser with LLM analyzer (OpenAI GPT-4o + Zod); dropped build time from ~5 weeks to ~3 weeks | Jun 2026 |
| 14 | LLM provider? | OpenAI GPT-4o (had OpenAI key; analyzer is provider-agnostic) | Jun 2026 |
| 15 | Mapping enricher (Phase 2)? | Folded into analyzer prompt context (not a separate phase); helped cut the estimate to ~3 weeks | Jun 2026 |

---

## 5. Resources

### Documentation
- v1 docs: https://docs.kognitos.com/legacy
- v2 docs: https://docs.kognitos.com/guides
- v2 Integrations: https://docs.kognitos.com/books
- v2 REST API: https://docs.kognitos.com/guides/api-reference/api-reference.md
- v2 MCP Server: https://docs.kognitos.com/guides/mcp/mcp.md
- v2 Glossary: https://docs.kognitos.com/guides/resources/glossary.md

### API Endpoints
- Platform API base: `https://app.us-1.kognitos.com/api/v1/...`
- MCP server: `https://mcp.us-1.kognitos.com/`
- Internal v1 GraphQL (HAR source): `https://api.app.kognitos.com/v2/app-production-k8s/graphql`

### External
- Anthropic API: https://docs.anthropic.com
- Vercel: https://vercel.com/docs
- XState: https://stately.ai/docs/xstate
- MCP spec: https://modelcontextprotocol.io

---

## 6. Success Criteria

Per migrated process:
- ✅ HAR extractor produces complete bundle (all subprocesses captured)
- ✅ Analyzer produces schema-valid IR with zero crashes on real input
- ✅ All books mapped or flagged as Manual
- ✅ SOP captures business intent (not v1 syntax)
- ✅ Test plan covers happy path + 2+ edge cases
- ✅ Agent creates v2 Automation matching SOP
- ✅ Test run succeeds (or exception resolved + run succeeds)
- ✅ Automation published in v2
- ✅ Report includes: source v1, generated SOP, test results, v2 Automation ID, duration, cost

---

## 7. Document Index

| # | Document | Purpose |
|---|---|---|
| 01 | This brief | Project spine |
| 02 | Platform differences | v1 vs v2 deep comparison |
| 03 | Glossary | Terminology mapping |
| 04 | Migration rules | 40+ numbered rules + edge cases |
| 05 | ~~Parser spec~~ | ⚠️ **DEPRECATED** — v1 DSL grammar + IR schema (superseded by 14) |
| 06 | Book mapping CSV | ~90 v1 books → v2 integrations |
| 07 | Sample process template | Test data guidance |
| 08 | v2 API spec | REST + MCP endpoints we use |
| 09 | Autonomous build loop | Agent state machine |
| 10 | Test plan generation | Claude prompt for tests |
| 11 | End-state report format | Migration report structure |
| 12 | **Input specification** | **HAR-first input architecture** ⭐ |
| 13 | **Technical architecture** | **Consolidated technical plan** ⭐ |
| 14 | **Analyzer spec** | **LLM-based v1 source → IR (replaces 05)** ⭐ |
