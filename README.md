# Kognitos Migration Utility — Cursor Setup Guide

> Complete setup instructions for starting development in Cursor.

---

## The Big Picture

**HAR in → bundle → IR → SOP/test plan → human OAuth setup → autonomous agent builds v2 → report out.**

You're building an internal autonomous migration agent. Input is a HAR file from v1 Kognitos UI. Output is a published v2 Automation + migration report.

---

## What's in This Package

```
cursor-setup-v2/
├── .cursorrules                 ← Cursor auto-loads this (project rules)
├── README.md                    ← This file
├── docs/                        ← 14 knowledge docs
│   ├── 01-project-brief.md
│   ├── 02-platform-differences.md
│   ├── 03-glossary.md
│   ├── 04-migration-rules-and-edge-cases.md
│   ├── 05-parser-spec.md             ⚠️ DEPRECATED (superseded by 14)
│   ├── 06-book-integration-mapping.csv
│   ├── 07-sample-process-template.md
│   ├── 08-v2-api-spec.md
│   ├── 09-autonomous-build-loop.md
│   ├── 10-test-plan-generation-spec.md
│   ├── 11-end-state-report-format.md
│   ├── 12-input-specification.md     ⭐ NEW (HAR-first input)
│   ├── 13-technical-architecture.md  ⭐ NEW (consolidated plan)
│   └── 14-analyzer-spec.md           ⭐ NEW (LLM-based analyzer, replaces 05)
└── samples/
    └── README.md                ← How to add real HAR captures
```

The two starred docs are the most important consolidated reference — read these first.

---

## Step 1 — Create the Project Folder

```bash
mkdir kognitos-migration-utility
cd kognitos-migration-utility
```

---

## Step 2 — Copy These Files Into Your Project

```bash
cp -r /path/to/cursor-setup-v2/* .
cp /path/to/cursor-setup-v2/.cursorrules .

# Verify
ls -la
# Should see: .cursorrules, README.md, docs/, samples/
```

---

## Step 3 — Initialize Git

```bash
git init
git add .
git commit -m "Initial: project knowledge + Cursor rules"
```

---

## Step 4 — Open in Cursor

```bash
cursor .
```

**Verify `.cursorrules` is loaded:** Look at the bottom-right status bar in Cursor — it should show the rules are active.

---

## Step 5 — Capture & Add Real HAR Bundles

This is **the most important prep step**. Without real HARs, you can't validate the extractor or analyzer.

### How to capture a HAR
1. Open Chrome → v1 Kognitos UI → your target agent
2. F12 → Network tab → ☑ Preserve log → ☑ Disable cache
3. **Click into every process** in the agent (wait for full load)
4. Right-click in Network tab → "Save all as HAR with content"
5. Save as `samples/agent-bundles/NN-name.har`

### Anonymize before committing
- The HAR may contain auth tokens (will be stripped by the sanitizer, but verify)
- Real customer/vendor names, emails → replace with placeholders
- See `docs/07-sample-process-template.md` for full checklist

### Minimum: 1-2 HARs
- One simple agent (2-3 processes)
- One complex agent with parent/child relationships (5+ processes)

---

## Step 6 — Get Kognitos API Credentials (Needed for Phase 5+)

Not needed for MVP (Phases 0-3), but needed when autonomous agent kicks in:

1. v2 UI → User Options → API Keys → Create New
2. Note Org ID + Workspace ID (in URL or settings)
3. Will store as environment variables in `.env.local` (Phase 0):
   ```
   KOGNITOS_PAT=...
   KOGNITOS_ORG_ID=...
   KOGNITOS_WORKSPACE_ID=...
   KOGNITOS_MCP_URL=https://mcp.us-1.kognitos.com/
   KOGNITOS_API_BASE=https://app.us-1.kognitos.com
   OPENAI_API_KEY=...                      # Process Analyzer (Phase 1)
   ANTHROPIC_API_KEY=...                    # SOP + test plan (Phase 3)
   ```

---

## Step 7 — Start Your First Cursor Session

Open Cursor's chat (Cmd/Ctrl+L). Paste this opening prompt:

```
Working on Kognitos v1→v2 Migration Utility. We're at Phase 0 (Project Setup).

Please scaffold the Next.js project per @docs/01-project-brief.md (Section 2) and @docs/13-technical-architecture.md.

Specifically:
1. Initialize Next.js 15 with App Router + TypeScript + Tailwind
2. Create the folder structure from the brief
3. Add dependencies: @anthropic-ai/sdk, xstate, zod, @modelcontextprotocol/sdk, better-sqlite3 (dev), @vercel/kv (prod)
4. Set up TypeScript strict mode
5. Create .env.example with all variables listed in @docs/13-technical-architecture.md Section 8
6. Add basic .gitignore
7. Add Vercel deployment configuration

Do not implement business logic yet. Just scaffold + verify `npm run dev` works.
```

Cursor scaffolds the project. Review, approve, and verify `npm run dev` works at `http://localhost:3000`.

---

## Step 8 — Phase Progression (Opening Prompts)

### Phase 0.5 — HAR Extractor ⭐ FIRST REAL CODE
```
Phase 0.5: implementing the HAR Extractor.

Spec: @docs/12-input-specification.md (Section 4) and @docs/04-migration-rules-and-edge-cases.md (MR-41 through MR-48).

Build in /src/lib/har/:
1. sanitizer.ts — strip auth, drop non-Kognitos entries (MR-41 — security critical, must be tested)
2. extractor.ts — parse GraphQL responses, extract procedures
3. call-graph.ts — build topological graph + detect cycles
4. book-detector.ts — naive book detection
5. types.ts — ExtractedAgentBundle, ExtractedProcess, CallGraph
6. index.ts — extractAgentBundleFromHar() public API

Tests against samples/agent-bundles/*.har. Verify zero auth headers survive sanitization.
```

### Phase 1 — Process Analyzer (LLM-based)
```
Phase 1: implementing the v1 Process Analyzer. Spec: @docs/14-analyzer-spec.md.
(The hand-written parser in @docs/05-parser-spec.md is DEPRECATED — do not build it.)

Build /src/lib/analyzer/:
1. prompt.ts — buildSystemPrompt() (inline IR schema + detection/MR rules:
   MR-2 ask/get/find, MR-19 parallel subprocess, MR-43 HAR refs) +
   buildUserPrompt(source, context); CallGraphContext type
2. schema.ts — V1ProcessIRSchema (Zod), kept structurally identical to @/types/ir
3. client.ts — analyzeProcess(source, context): OpenAI (GPT-4o) JSON mode →
   parse → Zod validate → ONE corrective retry on failure →
   deterministic stampMetadata(); AnalyzerError, ANALYZER_VERSION
4. index.ts — public exports

Input: ExtractedProcess.text + call-graph context. Output: V1ProcessIR directly.
Book→integration mapping context is folded into the prompt (no separate enricher).
Requires OPENAI_API_KEY. Tests: integration tests on golden fixtures.
```

### Phase 3 — SOP + Test Plan
```
Phase 3: SOP and test plan generation via Claude API.

Specs:
- SOP: @docs/04-migration-rules-and-edge-cases.md Section F (MR-25 to MR-29)
- Test plan: @docs/10-test-plan-generation-spec.md

Build /src/lib/sop/:
1. prompts/sop.ts — SOP prompt template
2. prompts/test-plan.ts — test plan prompt
3. claude-client.ts — Anthropic wrapper with retry
4. generator.ts — orchestrates both
5. validator.ts — Zod validation
6. /api/generate-sop/route.ts

Model: claude-sonnet-4-20250514. Validate outputs with Zod. Use call graph context for subprocess ordering.
```

### Phase 4 — Connection Setup UI
```
Phase 4: Connection setup UI (human-in-loop OAuth).

Build:
1. UI listing required v2 Connections (derived from IR + mapping)
2. Per Connection: link to v2 UI to set up
3. POST /api/connections/verify — checks v2 REST API to confirm
4. For SAP/NetSuite/Salesforce: Custom Actions discovery instructions
5. Once all verified, enable "Start Agent" button

Reference @docs/08-v2-api-spec.md for REST endpoints.
```

### Phase 5 — Autonomous Agent
```
Phase 5: the autonomous agent state machine.

Spec: @docs/09-autonomous-build-loop.md and @docs/08-v2-api-spec.md.

Build:
1. /src/lib/kognitos/ — MCP + REST client (start here, foundation)
2. /src/lib/agent/machines/migration.ts — XState v5 machine
3. Actor functions: createAutomation, pollRunStatus, resolveException, etc.
4. Persistence via Vercel KV (or SQLite for dev)
5. /api/agent/start, /api/agent/status (SSE)

Migrate processes in topological order (leaves first per MR-44).
Start with KognitosClient — everything depends on it.
```

### Phase 6 — Report
```
Phase 6: migration report.

Spec: @docs/11-end-state-report-format.md.

Build /src/lib/report/:
1. aggregator.ts — collects timeline data
2. json-renderer.ts
3. markdown-renderer.ts
4. html-renderer.tsx — React component for /report/[id]
5. Download endpoints (JSON, MD)
```

---

## Step 9 — Tips for Cursor Usage

### Pull docs into context efficiently
- Use `@docs/<filename>` to pull just relevant docs
- Don't load all 13 at once
- For HAR work: `@docs/12-input-specification.md @docs/04-migration-rules-and-edge-cases.md`
- For agent work: `@docs/09-autonomous-build-loop.md @docs/08-v2-api-spec.md`

### When Cursor gets confused
- Open a new chat (resets context)
- Re-paste session starter with right doc references
- If it disagrees with docs, docs win — point this out

### Code reviews
- Always review Cursor's output before accepting (especially API calls, state machine logic, HAR sanitization)
- Run tests after every significant change

### Planning vs coding
- For non-trivial architectural decisions: separate planning chat
- Don't try to code and design in the same chat

---

## Step 10 — Recommended First Day

1. **Setup** (30 min): Steps 1-4
2. **Capture 1-2 HARs** (1-2 hours): Step 5 — slowest but critical
3. **Phase 0** (1 hour): Scaffold the project
4. **Start Phase 0.5** (2-3 hours): Begin HAR extractor + sanitizer
5. **Commit**: Push to GitHub

That gets you a scaffolded project with a working HAR sanitizer + extractor skeleton. Strong first day.

---

## What Success Looks Like

- ✅ Phase 0: `npm run dev` shows Next.js page
- ✅ Phase 0.5: Drop a HAR → get back ExtractedAgentBundle JSON; auth headers verified gone
- ✅ Phase 1: Drop a HAR → get back IR JSONs from the analyzer (one `V1ProcessIR` per process)
- ✅ Phase 3: Clean v2 SOP + test plan output
- ✅ Phase 4: Verify Connections programmatically
- ✅ Phase 5: An automation gets created + tested + published in your v2 test workspace
- ✅ Phase 6: Beautiful migration report

---

## Help When Stuck

- Re-read the relevant doc; the answer is usually there
- Check `.cursorrules` for the Decision Protocol pattern
- Platform behavior questions → search the Kognitos docs URLs in `01-project-brief.md` Section 5
- HAR questions → `12-input-specification.md`
- Agent questions → `09-autonomous-build-loop.md`
- API questions → `08-v2-api-spec.md`
- Mapping questions → `06-book-integration-mapping.csv`

---

## You're Ready

Open Cursor, paste the Phase 0 prompt from Step 7, and start building. 🚀
