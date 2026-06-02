# Autonomous Build Loop — Agent State Machine Spec

> The heart of the migration utility's autonomy. Defines the state machine that takes an IR + SOP → a published v2 Automation.

---

## 1. Overview

The agent is a **finite state machine** that orchestrates the v2 Automation build, test, and publish lifecycle. It runs per-process (one machine instance per v1 process being migrated).

**Why a state machine:** Sequential nested promises become unmanageable for an agent with branching (success/failure/retry/intervention) paths. XState gives us:
- Explicit, inspectable states
- Guards/conditions for transitions
- Built-in retry/timeout handling
- Visualizable diagram (great for debugging)
- Persistence (resume across serverless invocations)

---

## 2. High-Level States

```
        ┌─────────┐
        │  idle   │
        └────┬────┘
             │ START
             ▼
        ┌─────────┐
        │ ready   │  ← prerequisites verified (Connections exist)
        └────┬────┘
             │ BUILD
             ▼
        ┌─────────────┐
        │ building    │  ← kognitos_create_automation in progress
        └──────┬──────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
  ┌─────────┐    ┌─────────────┐
  │ clarify │    │ build_failed│
  │ (loop)  │    └─────────────┘
  └────┬────┘
       │ thread complete
       ▼
  ┌─────────┐
  │ created │  ← Automation exists in DRAFT
  └────┬────┘
       │ TEST
       ▼
  ┌─────────┐
  │ testing │  ← invoke run, poll status
  └────┬────┘
       │
   ┌───┴───┬────────┬───────────┐
   │       │        │           │
   ▼       ▼        ▼           ▼
 ┌──────┐ ┌──────┐ ┌─────────┐ ┌──────────┐
 │passed│ │failed│ │exception│ │ timed_out│
 └──┬───┘ └──┬───┘ └────┬────┘ └────┬─────┘
    │        │           │            │
    │        │           ▼            │
    │        │      ┌─────────┐       │
    │        │      │resolving│       │
    │        │      │exception│       │
    │        │      └────┬────┘       │
    │        │           │            │
    │        │      ┌────┴────┐       │
    │        │      │         │       │
    │        │  resolved   unresolved │
    │        │      │         │       │
    │        │      └→testing │       │
    │        │                │       │
    │        ▼                ▼       ▼
    │   ┌──────────────────────────┐
    │   │      escalate_to_human    │
    │   └──────────────────────────┘
    │
    ▼
┌──────────┐
│publishing│  ← kognitos_manage_automation:publish
└────┬─────┘
     │
     ▼
┌─────────┐
│  done   │  ← report generated, agent terminates
└─────────┘
```

---

## 3. State Details

### `idle`
**Entry:** Machine just spawned for a v1 process
**Context:** `{ v1Source, ir, sop, testPlan, mappingCatalog, connectionsReady: false }`
**Transitions:**
- `START` → `ready` (if Connections check passes)
- `START` → `escalate_to_human` (if missing Connections)

### `ready`
**Entry:** All required v2 Connections verified to exist
**Actions:**
- Verify each book in IR has a corresponding Connection
- For SAP/NetSuite/Salesforce: verify Custom Actions discovered
**Transitions:**
- `BUILD` → `building`

### `building`
**Entry:** Calling `kognitos_create_automation` with SOP
**Actions:**
- Send SOP text as natural language description
- Capture returned automation ID + thread ID
- Set timeout (30 minutes max)
**Transitions:**
- `BUILD_PROGRESS` (thread message received) → `clarify`
- `BUILD_COMPLETE` (no clarifications) → `created`
- `BUILD_ERROR` → `build_failed`
- `TIMEOUT` → `escalate_to_human`

### `clarify` (loop sub-state)
**Entry:** Thread message received from Kognitos's draft builder
**Actions:**
- Read message via `kognitos_threads:list_messages`
- Generate answer using Claude API with context: IR, original SOP, message
- Send answer via `kognitos_manage_thread:send_message`
- Track clarification count
**Transitions:**
- `MESSAGE_RECEIVED` → `clarify` (loop)
- `MAX_CLARIFICATIONS_REACHED` (default: 10) → `escalate_to_human`
- `THREAD_COMPLETE` → `created`

### `created`
**Entry:** Automation exists in DRAFT stage
**Actions:**
- Fetch automation via `kognitos_automations:get`
- Verify `input_specs` matches expected from IR
- Verify referenced Connections are bound
**Transitions:**
- `INPUT_SPEC_MISMATCH` → `clarify` (send corrective message)
- `READY_TO_TEST` → `testing`

### `testing`
**Entry:** Have automation + test plan ready
**Actions:**
- Pick next test case from test plan
- Upload required files via `kognitos_upload_file` (if needed)
- Invoke via `kognitos_invoke_automation` with stage=`DRAFT`
- Poll run status (2s → 30s exponential backoff)
- Set per-run timeout (10 min)
**Transitions:**
- Run state `completed` + outputs match expected → check next test case
- All test cases passed → `passed`
- Run state `completed` + outputs don't match → `failed` (with diff)
- Run state `failed` → `failed`
- Run state `awaiting_guidance` → `resolving_exception`
- Run state stuck > timeout → `timed_out`

### `resolving_exception`
**Entry:** Run is awaiting guidance (exception raised)
**Context update:** `{ exceptionId, exceptionDescription, exceptionLocation }`
**Actions:**
- Fetch exception details + check Troubleshooting Guide
- Generate resolution via Claude API with context: exception details, IR (especially `ask`/`get`/`find` semantics), original test case
- Send via `kognitos_reply_to_exception`
- Track resolution attempts per exception (max 3)
**Transitions:**
- Exception resolved + run resumed → `testing` (continue same test)
- Resolution rejected by Kognitos → `resolving_exception` (retry with different guidance)
- `MAX_RESOLUTION_ATTEMPTS` → `escalate_to_human`

### `passed`
**Entry:** All test cases succeeded
**Actions:**
- Record test pass evidence in report
- Verify automation is publishable (no draft-only resources)
**Transitions:**
- `PUBLISH` → `publishing`

### `publishing`
**Entry:** Publishing the automation
**Actions:**
- Call `kognitos_manage_automation:publish`
- Verify new version created
- Activate the automation (`activation_state: ACTIVE`)
**Transitions:**
- `PUBLISHED` → `done`
- `PUBLISH_ERROR` → `escalate_to_human`

### `done`
**Entry:** Terminal success state
**Actions:**
- Generate per-process report section
- Save automation ID → v1 source mapping to persistence
- Emit `migration.complete` event for the orchestrator

### `failed`
**Entry:** Test run failed in a non-recoverable way
**Actions:**
- Capture failure details
- Decide: retry build OR escalate
- If first failure: try once more with extra context
**Transitions:**
- `RETRY` → `building` (max 1 retry)
- `ESCALATE` → `escalate_to_human`

### `escalate_to_human`
**Entry:** Anything that requires manual intervention
**Context:** `{ escalationReason, automationId?, runId?, exceptionId? }`
**Actions:**
- Update UI status to "Needs human review"
- Persist current state for resume
- Send notification (if configured)
**Transitions:**
- `HUMAN_RESOLVED` (with payload) → resume from prior state
- `HUMAN_ABANDONED` → `done` (with status `failed_manual`)

---

## 4. State Persistence

Each machine instance must be **resumable across serverless invocations**.

### Persistence schema (Vercel KV or SQLite)

```typescript
interface AgentInstance {
  id: string;                          // UUID for this migration run
  v1ProcessId: string;                 // identifier for the v1 process
  state: string;                       // current state name
  context: {
    v1Source: string;
    ir: V1ProcessIR;
    sop: string;
    testPlan: TestPlan;
    automationId?: string;
    threadId?: string;
    currentRunId?: string;
    currentTestCaseIndex: number;
    clarificationCount: number;
    resolutionAttempts: Record<string, number>;  // by exceptionId
    errors: AgentError[];
    timeline: TimelineEvent[];          // for report
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'needs_human';
}
```

### Resume flow
1. UI loads `/agent/status/{id}` → checks `status`
2. If `running`, the orchestrator may have died; recreate machine from persisted state
3. Re-enter the current state, re-fetching live data from Kognitos as needed

---

## 5. Concurrency

**Per migration:** 1 machine per v1 process
**Per workspace:** Max 5 concurrent machines (rate limiting)
**Per Kognitos PAT:** Max 10 req/s (client-side throttle)

For batch migrations:
- Queue all processes
- Spawn 5 machines concurrently
- As each `done`, start next from queue
- All complete → generate batch report

---

## 6. Observability

Each state transition emits a structured event:

```typescript
interface TimelineEvent {
  timestamp: string;
  type: 'state_enter' | 'state_exit' | 'api_call' | 'error' | 'human_intervention';
  state: string;
  data: Record<string, unknown>;
  duration_ms?: number;
}
```

Stored on the machine context; surfaced in:
- Real-time UI updates (via Server-Sent Events or polling)
- Final migration report
- Debug logs (when in dev mode)

---

## 7. Edge Cases & Failure Modes

| Scenario | Behavior |
|---|---|
| Kognitos API down | Retry with backoff up to 5 min, then escalate |
| Created automation has unexpected input_specs | Send corrective thread message; if persists, escalate |
| Test data file too large for upload | Use pre-signed URL upload path |
| Exception resolution agent gives up | Capture full context, escalate |
| Connection revoked mid-migration | Pause machine, alert human, await re-auth |
| Custom Action not discovered after wait | Surface to UI: "Run Configure Actions in v2 UI" |
| Published automation activation fails | Stay in `publishing`, retry once, then escalate |
| Parallel `start a run` in source | Already flagged in IR; SOP includes redesign; agent proceeds with single-process equivalent |

---

## 8. Hard Limits

- Max clarifications per build: **10**
- Max exception resolution attempts: **3** per exception
- Max test case retries: **1**
- Max build retries: **1**
- Per-run timeout: **10 minutes**
- Per-migration timeout: **60 minutes**
- Polling backoff: 2s → 4s → 8s → 16s → 30s (cap)

---

## 9. XState Skeleton (Implementation Sketch)

```typescript
import { setup, fromPromise } from 'xstate';

export const migrationMachine = setup({
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
  },
  actors: {
    createAutomation: fromPromise(/* MCP call */),
    pollRunStatus: fromPromise(/* polling logic */),
    resolveException: fromPromise(/* Claude + MCP call */),
    publishAutomation: fromPromise(/* MCP call */),
  },
  guards: {
    connectionsReady: ({ context }) => /* check */,
    moreTestCases: ({ context }) => /* check */,
    maxClarificationsReached: ({ context }) => context.clarificationCount >= 10,
  },
}).createMachine({
  id: 'migration',
  initial: 'idle',
  context: { /* initial context */ },
  states: {
    idle: { /* ... */ },
    ready: { /* ... */ },
    building: { /* ... */ },
    clarify: { /* ... */ },
    created: { /* ... */ },
    testing: { /* ... */ },
    resolving_exception: { /* ... */ },
    passed: { /* ... */ },
    publishing: { /* ... */ },
    done: { type: 'final' },
    escalate_to_human: { /* ... */ },
    failed: { /* ... */ },
  },
});
```

Full implementation lives in `/src/lib/agent/machines/migration.ts`.
