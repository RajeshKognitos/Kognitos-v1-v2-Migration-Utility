# Kognitos v2 API Spec — REST + MCP Reference

> Definitive reference for all v2 API capabilities we use in the migration utility. Based on research of `docs.kognitos.com/guides/api-reference/` and `docs.kognitos.com/guides/mcp/`.

---

## 1. Authentication

### Platform REST API
- **Auth:** Bearer token (Personal Access Token)
- **Header:** `Authorization: Bearer <PAT>`
- **Base URL:** `https://app.us-1.kognitos.com`
- **Path prefix:** `/api/v1/organizations/{org_id}/workspaces/{workspace_id}/...`
- **Get PAT:** UI → User Options → API Keys

### MCP Server
- **URL:** `https://mcp.us-1.kognitos.com/`
- **Transport:** Streamable HTTP
- **Auth options:**
  - **OAuth 2.1** (recommended for interactive) — client opens browser to Kognitos login, receives short-lived token
  - **API Key** (for CI/scripts) — `Authorization: Bearer <PAT>`

### Legacy REST API v2 (separate surface — only for triggering runs)
- **Base URL:** `https://rest-api.app.kognitos.com/v2`
- **Header:** `x-api-key: <key>`
- *We won't use this in the migration utility — it's the legacy run-trigger API.*

---

## 2. MCP Tools (Primary Surface for Agent)

The MCP server is the **primary interface** for our autonomous agent. Tools are grouped by resource.

### Organizations & Workspaces
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_list_organizations` | — | List orgs user belongs to |
| `kognitos_list_workspaces` | — | List workspaces in an org |

### Automations (Core for our agent)
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_automations` | `list`, `get`, `query` | Browse/inspect automations by stage (DRAFT/PUBLISHED) |
| `kognitos_create_automation` | — | **Create new automation from natural language description** — THE KEY TOOL |
| `kognitos_threads` | `get`, `list`, `list_messages` | Read draft-conversation state |
| `kognitos_manage_thread` | `create`, `send_message`, `stop` | Drive the conversational Draft builder |
| `kognitos_manage_automation` | `publish`, `activate`, `deactivate`, `delete`, `discard_draft`, `rename`, `fork` | Lifecycle management |
| `kognitos_invoke_automation` | — | Start a run |

### Runs (Testing & Diagnosis)
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_runs` | `list`, `get`, `get_run_outputs`, `list_events` | Monitor runs, fetch outputs/logs |
| `kognitos_control_run` | `pause`, `continue` | Lifecycle control |

### Scheduling
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_get_schedule` | — | Get current schedule |
| `kognitos_manage_schedule` | `create`, `update`, `enable`, `disable`, `delete` | Configure schedules |

### Exceptions (Auto-resolution loop)
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_inspect_exceptions` | `list`, `get`, `count`, `list_events`, `get_guide`, `list_guides` | Read exceptions + troubleshooting guides |
| `kognitos_reply_to_exception` | — | **Send message to exception resolution agent** — enables auto-resolve |
| `kognitos_manage_exceptions` | `archive`, `unarchive`, `assign` | Manage exception state |

### Integrations
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_books` | `search`, `list_workspace_books`, `search_procedures` | Discover integrations + actions |

### Analytics
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_analytics` | `run_stats`, `insights`, `exception_insights` | Platform metrics |

### Files
| Tool | Actions | Purpose |
|---|---|---|
| `kognitos_read_file` | `get_metadata`, `read_file` | Inspect/read files |
| `kognitos_upload_file` | — | Upload files (base64 or pre-signed URL) |

---

## 3. REST API (Secondary Surface for Direct Resource Control)

When MCP doesn't expose what we need, use the REST API directly.

### Automation Resource
**Key endpoints:**

```
GET    /api/v1/organizations/{org}/workspaces/{ws}/automations/{automation_id}
GET    /api/v1/organizations/{org}/workspaces/{ws}/automations/{automation_id}:query?stage=...
GET    /api/v1/organizations/{org}/workspaces/{ws}/automations/{automation_id}/revisions
GET    /api/v1/organizations/{org}/workspaces/{ws}/automations/{automation_id}/revisions/{rev}
```

**Automation object key fields:**

```typescript
interface V1Automation {
  name: string;                       // "automations/{id}"
  display_name: string;               // human-readable, unique
  english_code: string;               // user-facing English explanation
  code: string;                       // SPy (Subset-of-Python) executable
  artifacts: Record<string, string>;  // base64 binary artifacts
  create_time: string;
  version: string;                    // e.g. "1.0", "1.1", "2.0"
  connections: Record<string, BookConnection>;
  update_time: string;
  input_specs: AutomationInputSpec[];
  description: string;
  latest_published_version: string | null;
  activation_state: 'ACTIVE' | 'DEACTIVATED' | 'UNSPECIFIED';
  default_inputs: Record<string, Value>;
  marked_outputs: string[];
  code_mapping: {                     // bidirectional english↔spy mapping
    entries: { spy_location: Location; english_location: Location }[]
  };
}
```

### Runs Resource

```
GET    /api/v1/.../automations/{automation_id}/runs                  # List
GET    /api/v1/.../automations/{automation_id}/runs/{run_id}         # Get
POST   /api/v1/.../automations/{automation_id}/runs/{run_id}:pause   # Pause
POST   /api/v1/.../automations/{automation_id}/runs/{run_id}:continue # Continue
GET    /api/v1/.../workspaces/{ws}:automationRunAggregates           # Metrics
```

**Run states (discriminated union):**
- `pending` — queued, awaiting resources
- `executing` — actively running
- `stopping` — graceful stop in progress
- `stopped` — paused, can resume
- `awaiting_guidance` — needs human/AI intervention (exception raised) — has `exception` ID, `description`, `location`
- `completed` — success — has `outputs`
- `failed` — error — has `id`, `description`, `location`

**Critical: when state is `awaiting_guidance`**, we have the exception ID and can call `kognitos_reply_to_exception` to provide guidance and continue.

### Other Resources (per `/api-reference/` sitemap)
- `/organizations`
- `/workspaces`
- `/books`
- `/files`
- `/exceptions`
- `/analytics`

---

## 4. Critical Behaviors & Constraints

### Automation Lifecycle
- Automations have stages: `DRAFT` and `PUBLISHED`
- Publishing creates a new version (semantic: `0.1`, `1.0`, `1.1`, `2.0`)
- Published automations are **immutable**
- To change: `Edit as Draft` → modify → republish
- In-progress runs **pin** to their starting version
- New runs use latest published version

### Connections
- Reusable, secure credential sets
- Per-Integration; multiple Connections per Integration allowed
- Test vs Production environment toggle
- **Initial setup requires OAuth flow for many integrations** (Gmail, Outlook, Salesforce, etc.) — must be done by human in v2 UI
- Once set up, Automations reference Connections by `connection_id`

### Custom Actions Discovery
- For **SAP, NetSuite, Salesforce** only
- After Connection setup → `Configure Actions` → search/toggle services → save
- 1-2 minute discovery time
- Action names are **tenant-generated** (can't be statically mapped)
- Our agent must wait for discovery before referencing custom actions

### Run States — Polling
- **No webhooks documented** for run state changes
- Pattern: poll `kognitos_runs:get` or `GET /runs/{id}` every 2-5 seconds
- Terminal states: `completed`, `failed`, `stopped`
- Intermediate states: `pending`, `executing`, `stopping`, `awaiting_guidance`

### Threads (Conversational Draft Builder)
- When you call `kognitos_create_automation`, it may produce clarifying questions
- These come back as messages in a **thread**
- Use `kognitos_manage_thread:send_message` to answer
- Use `kognitos_threads:list_messages` to read responses

---

## 5. Our TypeScript API Client (To Build)

We'll build a thin client wrapping both surfaces:

```typescript
// src/lib/kognitos/index.ts

export class KognitosClient {
  constructor(private config: {
    pat: string;
    orgId: string;
    workspaceId: string;
    mcpUrl?: string;
    apiBaseUrl?: string;
  }) {}

  // MCP-based operations (preferred for high-level)
  async createAutomationFromSop(sop: string, displayName: string): Promise<Automation> { /* ... */ }
  async sendMessageToThread(threadId: string, message: string): Promise<ThreadMessage[]> { /* ... */ }
  async invokeAutomation(id: string, inputs: Record<string, Value>, stage: 'DRAFT' | 'PUBLISHED'): Promise<Run> { /* ... */ }
  async replyToException(exceptionId: string, guidance: string): Promise<void> { /* ... */ }
  async publishAutomation(id: string): Promise<Automation> { /* ... */ }

  // REST-based operations (for direct resource access)
  async getAutomation(id: string, stage?: 'DRAFT' | 'PUBLISHED'): Promise<Automation> { /* ... */ }
  async getRun(automationId: string, runId: string): Promise<Run> { /* ... */ }
  async pauseRun(automationId: string, runId: string, reason: string): Promise<Run> { /* ... */ }
  async continueRun(automationId: string, runId: string): Promise<Run> { /* ... */ }
  async listBooks(): Promise<Book[]> { /* ... */ }

  // Polling helpers
  async waitForRunTerminal(automationId: string, runId: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<Run> { /* ... */ }
}
```

**Implementation notes:**
- For MCP: use the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- For REST: use `fetch` with typed wrappers
- All methods return typed objects matching the OpenAPI schemas
- Polling uses exponential backoff
- All methods log to a structured logger (for the report)

---

## 6. Known Limitations & Workarounds

| Limitation | Workaround |
|---|---|
| No webhooks for run state | Poll with exponential backoff (2s → 30s max) |
| OAuth Connection setup requires browser | Phase 4: human-in-loop setup UI |
| Custom Action discovery (SAP/NS/SF) needs UI | Phase 4: instruct user to run discovery, wait 1-2 min |
| No bulk import for v1 processes | This is exactly what our utility provides |
| No official TypeScript SDK | We build a thin wrapper around OpenAPI spec |
| MCP tool list may evolve | Pin to discovered tool set; handle gracefully if missing |

---

## 7. Rate Limits & Quotas
**Not documented in public docs** — we assume conservative defaults:
- Max 10 requests/second per PAT
- Implement client-side throttling + retry with backoff
- Monitor 429 responses, back off appropriately

---

## 8. Error Handling Standard

Every API call wraps in try/catch with structured error:

```typescript
interface KognitosApiError {
  code: number;
  message: string;
  details?: unknown[];
  endpoint: string;
  retryable: boolean;
}
```

- Retryable errors (5xx, 429, network): retry up to 3x with exponential backoff
- Non-retryable (4xx other than 429): fail fast, surface to UI
- All errors logged to migration report

---

## 9. Quick Test (When You Have a PAT)

Once you have a PAT and a test workspace, verify with:

```bash
# Test PAT works
curl -H "Authorization: Bearer YOUR_PAT" \
  https://app.us-1.kognitos.com/api/v1/organizations/YOUR_ORG/workspaces/YOUR_WS/automations

# Should return list of automations or empty array
```
