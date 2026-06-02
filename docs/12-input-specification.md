# Input Specification — HAR-First Architecture

> Defines all input modes for the migration utility. **HAR is the primary input.** Other modes exist as fallbacks.

---

## 1. Why HAR First

HAR (HTTP Archive) capture from the v1 Kognitos UI was validated as the optimal input mechanism. From a single HAR file we extract:

- ✅ **Multiple v1 processes** in one upload (verified: 7 processes from a single HAR)
- ✅ **Full source code** of each process (via `procedureGroup` GraphQL responses)
- ✅ **Subprocess call graph with deterministic IDs** (parent processes contain `@{...UUID...}` references to children)
- ✅ **Metadata**: owner, version, stage (DRAFT/PUBLISHED), schedules, language
- ✅ **Department ID** (= v1 agent identifier)
- ✅ **Last run data** (timestamps + status)

The alternative — manual paste of each process — is tedious, error-prone, and loses relationships.

---

## 2. Input Tiers

### Tier 1: HAR Upload (PRIMARY)
**Use case:** Migrating an entire v1 agent (one or many processes with relationships).
**User action:**
1. Open v1 Kognitos UI in Chrome
2. Open DevTools (F12) → Network tab
3. Click "Preserve log", check "Disable cache"
4. Open the target agent
5. **Scroll through every process** (this triggers the GraphQL fetches that load the full text)
6. Right-click in Network tab → "Save all as HAR with content"
7. Upload `.har` file to migration utility

**Provides:** Complete process source + call graph + metadata.

### Tier 2: Text Paste / `.txt` Upload (FALLBACK)
**Use case:** Migrating a single process when HAR isn't available.
**User action:** Paste the v1 DSL into a textarea, or upload a `.txt`/`.md` file.
**Provides:** Process source only — no metadata, no call graph (user must paste children separately).

### Tier 3: v1 Agent Export `.json` (FALLBACK)
**Use case:** When user has previously exported their agent from v1 UI (Settings → Export Agent).
**User action:** Upload the `.json` file.
**Provides:** Published processes + learnings + books (per v1 export feature). Does NOT include drafts or credentials.

---

## 3. HAR File Specification

### 3.1 Expected HAR Source
HAR captures from `*.kognitos.com` (the v1 UI). Verified working: HAR from `api.app.kognitos.com` GraphQL endpoint.

### 3.2 Required GraphQL Operations
The HAR must contain responses to these GraphQL operations (otherwise we have insufficient data):

| GraphQL Operation | Purpose | Required? |
|---|---|---|
| `procedureGroup` | Returns full process source (`text` field) per process | **REQUIRED** (one per process) |
| `listProcedureGroupsByDepartment` | Lists all process IDs in the agent | Optional (helps detect missing processes) |
| `GetDepartmentUnpublishedChanges` | Lists installed books/integrations | Optional (helps with book mapping) |
| `ListDepartmentCollaborators` | Workspace metadata | Optional |
| `proceduresMetric` | Run statistics | Optional (informs test data) |

### 3.3 HAR Validation Rules
On upload, validate:
- File is valid JSON
- `log.entries` exists and is non-empty
- At least 1 entry to `*.kognitos.com/*/graphql` exists
- At least 1 `procedureGroup` response contains a non-null `text` field
- Total HAR size ≤ 100 MB (sanity limit)

If validation fails → surface user-friendly error with screenshot of what to capture.

### 3.4 Sanitization on Upload (Security Critical)

HAR files contain authentication tokens. **Strip immediately on upload**, before any processing:

```typescript
function sanitizeHarBeforeStorage(har: HarFile): HarFile {
  for (const entry of har.log.entries) {
    // Strip auth headers
    entry.request.headers = entry.request.headers.filter(
      h => !['authorization', 'cookie', 'x-api-key', 'x-auth-token'].includes(h.name.toLowerCase())
    );
    // Strip set-cookie
    entry.response.headers = entry.response.headers.filter(
      h => h.name.toLowerCase() !== 'set-cookie'
    );
    // Strip query string auth params
    entry.request.queryString = entry.request.queryString.filter(
      q => !['token', 'access_token', 'api_key'].includes(q.name.toLowerCase())
    );
    // Drop non-Kognitos entries entirely (don't need them)
    // Only keep entries where url contains kognitos.com
  }
  return har;
}
```

**Then drop everything that's not relevant** — keep only Kognitos GraphQL responses. This dramatically reduces stored data and risk surface.

---

## 4. HAR Extractor Specification

### 4.1 Module: `/src/lib/har/extractor.ts`

```typescript
export interface ExtractedAgentBundle {
  sourceMeta: {
    harFilename: string;
    extractedAt: string;
    extractorVersion: string;
    departmentId: string | null;  // = v1 agent ID
  };
  processes: ExtractedProcess[];
  callGraph: CallGraph;
  detectedBooks: string[];        // naive heuristic; refined by parser+mapping
  warnings: ExtractionWarning[];  // missing processes, ambiguous refs, etc.
}

export interface ExtractedProcess {
  id: string;                     // Kognitos procedure ID
  name: string;                   // e.g. "to process invoices"
  owner: string | null;
  stage: 'DRAFT' | 'PUBLISHED';
  version: string;                // ISO timestamp from v1
  departmentId: string;
  language: 'english';
  text: string;                   // full v1 DSL source
  lineCount: number;
  schedules: Schedule[];          // if PUBLISHED
  latestRunData: RunSummary | null;
  sourceHash: string;             // sha256 of text (for traceability)
  subprocessRefs: SubprocessRef[];  // parsed inline @{...} references
}

export interface SubprocessRef {
  displayName: string;            // human name
  targetId: string;               // procedure ID it points to
  callType: 'invoke' | 'run' | 'start_a_run';  // detected from surrounding syntax
  resolvableInBundle: boolean;    // true if targetId is in `processes`
  position: { line: number; col: number };
}

export interface CallGraph {
  nodes: { id: string; name: string }[];
  edges: { from: string; to: string; callType: string }[];
  roots: string[];                // process IDs with no incoming edges (likely entry points)
  leaves: string[];               // process IDs with no outgoing edges (utilities)
  cycles: string[][];             // detected cycles (recursive calls)
}

export interface ExtractionWarning {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export async function extractAgentBundleFromHar(harContent: string): Promise<ExtractedAgentBundle>;
```

### 4.2 Extraction Algorithm

```
1. Parse HAR JSON
2. Sanitize: strip auth, drop non-Kognitos entries
3. Iterate entries:
   For each entry where url matches `*/graphql` and response is JSON:
     a. Parse request body to get operationName
     b. If operationName == 'procedureGroup':
        - Extract draftProcedure + publishedProcedure
        - Prefer publishedProcedure if both have text; else use draft
        - Store under procedure.id (deduplicate)
     c. If operationName == 'listProcedureGroupsByDepartment':
        - Extract listing → cross-reference (warn about IDs in listing but not in full text)
     d. If operationName == 'GetDepartmentUnpublishedChanges':
        - Extract installed integrations (if non-empty)
4. For each extracted procedure:
   a. Parse text for inline subprocess refs: `@{"type": "procedure", "display": "...", "value": "ID"}`
   b. Detect call type from surrounding context (look back to find `invoke`/`run`/`start a run`)
   c. Add to subprocessRefs
5. Build call graph:
   a. Nodes = all extracted procedures
   b. Edges = from each procedure to its subprocess refs (only if target is in bundle)
   c. Roots = nodes with no incoming edges
   d. Leaves = nodes with no outgoing edges
   e. Detect cycles via DFS
6. Naive book detection:
   a. For each procedure, lowercase text + match against BOOK_HINTS
   b. Aggregate into detectedBooks
7. Emit warnings:
   a. If subprocess ref's targetId NOT in bundle → warning ("missing process — user must scroll/capture")
   b. If cycles detected → info (recursion needs review)
   c. If any procedure lacks text → warning ("listing had it but no full fetch captured")
8. Return ExtractedAgentBundle
```

### 4.3 Subprocess Reference Detection

The v1 source embeds subprocess references as JSON-in-DSL:

```
invoke @{"type": "procedure", "display": "respond to vendorQuery2", "value": "d6b0ax4z36dakxfeudi1ubyif"} with
  the caseID
  the vendor email
```

Regex (verified against real HAR):
```javascript
const SUBPROCESS_REF_RE = /@\{"type":\s*"procedure",\s*"display":\s*"([^"]+)",\s*"value":\s*"([^"]+)"\}/g;
```

Call-type detection: look at the token immediately preceding the `@{...}` on the same line:
- `invoke @{...}` → `invoke`
- `run @{...}` → `run`
- `start a run where ... the procedure is @{...}` → `start_a_run`

### 4.4 Book Detection Hints (Naive — Parser Confirms)

```typescript
const BOOK_HINTS: Record<string, string[]> = {
  salesforce: ['salesforce', 'sfdc'],
  servicenow: ['servicenow', 'snow ticket', 'snow case'],
  email: ['send an email', 'send email'],
  outlook: ['outlook'],
  gmail: ['gmail'],
  slack: ['slack'],
  sap: ['from sap', 'in sap', 'sap material', 'sap order'],
  netsuite: ['netsuite'],
  sharepoint: ['sharepoint'],
  idp: ['ask koncierge', 'extract data from', 'extract the data from', 'extract pages', 'extract subdocuments'],
  http: ['http get', 'http post', 'send http', 'http request'],
  s3: ['from s3', 'to s3', 'aws s3'],
  database: ['from the database', 'into the database', 'select from'],
  pdf: ['the pdf', 'as a pdf', 'merge pdf'],
  excel: ['the excel', 'worksheet', 'workbook'],
  sftp: ['sftp', 'from sftp', 'to sftp'],
  airtable: ['airtable'],
  zendesk: ['zendesk'],
  jira: ['jira'],
  // ... full list synced with 06-book-integration-mapping.csv
};
```

This is a **first pass**. The full Phase 1 parser does authoritative detection.

---

## 5. UI Input Flow

```
┌──────────────────────────────────────────────────────┐
│  Upload v1 Agent                                      │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  Drop .har file here, or click to browse      │  │
│  │  (Tier 1 — recommended)                       │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ▼ Or use a fallback:                                 │
│  ○ Paste process text (single process)                │
│  ○ Upload v1 Agent Export .json                       │
└──────────────────────────────────────────────────────┘
```

After upload:

```
┌──────────────────────────────────────────────────────┐
│  📦 Agent Bundle Detected                             │
│                                                       │
│  ✅ 7 processes extracted                             │
│  ✅ Call graph resolved (3 roots, 5 leaves)           │
│  ✅ 0 missing subprocess references                   │
│  ⚠️  2 books detected: ServiceNow, IDP                │
│                                                       │
│  ┌────────── Call Graph Visualization ────────────┐  │
│  │   [to process vendorhelpdesk emails]            │  │
│  │     ├─→ [respond to vendorQuery2]               │  │
│  │     │     ├─→ [process the DP numbers]          │  │
│  │     │     ├─→ [retrieve payment advise...]      │  │
│  │     │     └─→ [Update ServiceNow ticket]        │  │
│  │     └─→ [Update ServiceNow ticket]              │  │
│  │   [Send processed ticket report] (orphan?)       │  │
│  │   [send payment advice to vendors] (orphan?)     │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  Choose processes to migrate:                         │
│  ☑ All                                                │
│  ☐ Select individually...                             │
│                                                       │
│  [Continue →]                                         │
└──────────────────────────────────────────────────────┘
```

---

## 6. Capturing a Good HAR (User Guide)

Include this as in-product help text:

> **How to capture a HAR file for migration:**
>
> 1. Open your v1 Kognitos agent in **Google Chrome** (other browsers work but Chrome is most reliable)
> 2. Press **F12** to open Developer Tools, click the **Network** tab
> 3. Check ☑ **Preserve log** and ☑ **Disable cache**
> 4. Click the 🔴 record button if not already recording
> 5. **Click into each process** you want to migrate — wait for the editor to load fully before moving to the next. *(This step is critical — only opened processes have their source code captured.)*
> 6. When done, right-click in the Network tab → **"Save all as HAR with content"**
> 7. Upload the `.har` file here
>
> **Tips:**
> - You don't need to scroll through every line of code — just opening the process is enough
> - Subprocess calls (children) need to be opened separately for their source to be captured
> - The migration utility will tell you if any process source is missing from the HAR

---

## 7. Failure Modes & Error Messages

| Failure | UI Message |
|---|---|
| File isn't valid JSON | "This doesn't look like a valid HAR file. Did you save the right export?" |
| No Kognitos GraphQL entries | "No Kognitos API traffic detected in this HAR. Was it captured while using v1 Kognitos?" |
| 0 procedures with text | "Found Kognitos traffic but no process source code. Did you click into each process before saving?" |
| Some procedures missing text | "Found X processes but Y are missing source code. Open these in v1 and recapture: [list]" |
| Subprocess refs to unknown procedures | "Process A calls 'B' but B's source isn't in this HAR. Open B in v1 and recapture." |
| File too large (>100MB) | "HAR file exceeds 100MB. Try capturing in smaller batches per agent." |

---

## 8. Privacy & Data Handling

### What we extract and store
- Process source text (v1 DSL)
- Process metadata (name, owner email, version, timestamps)
- Subprocess relationships
- Schedule configurations

### What we DROP on upload (never stored)
- All auth headers / cookies / tokens
- All non-Kognitos requests (analytics, ads, telemetry)
- Request/response bodies for non-`procedureGroup` ops we don't need
- IP addresses

### Retention
- Extracted bundle persisted for the duration of the migration session
- Migration report includes a SHA256 of the v1 source for traceability
- After migration completes successfully → optionally purge source text (configurable)

### Compliance
- Owner email addresses are PII → flagged in report
- Process text may contain customer/vendor data → not displayed in shared reports

---

## 9. Output: How the Bundle Feeds the Pipeline

```
HAR upload
    │
    ▼
HAR Extractor (this doc)
    │  emits: ExtractedAgentBundle (JSON)
    ▼
Parser (Phase 1) — runs once per process in bundle
    │  emits: V1ProcessIR[]  (one per process)
    ▼
Mapping Enricher (Phase 2) — uses 06-book-integration-mapping.csv
    │  emits: V1ProcessIR[] with v2 integration data
    ▼
SOP + Test Plan Generator (Phase 3, Claude)
    │  emits: SOP + TestPlan per process; also uses callGraph
    │         from bundle to handle subprocess ordering
    ▼
Agent (Phase 5) — migrates in topological order (leaves first)
    │  emits: v2 Automations + run results
    ▼
Report (Phase 6)
```

The **call graph from the HAR bundle is critical** — it tells the agent which order to migrate processes in (children before parents).

---

## 10. Sample HAR Test Fixture

A real HAR (`test1_VendorQueryHelpdesk-VHD.har`) was used to validate this spec. Results:
- 7 procedures extracted (516 lines total)
- 100% subprocess refs resolvable
- Books detected: ServiceNow, Email, IDP/Koncierge, SAP, base64

**Save sanitized version as `samples/agent-bundles/01-vendor-helpdesk.har`** for parser/extractor unit tests.

---

## 11. Open Questions

- Should we support **HAR diff mode**? (User uploads new HAR after editing in v1 → only re-migrate changed processes.) — Defer to v2.
- Can we auto-detect the **department/agent name** from the HAR? — Yes, via `ListDepartmentCollaborators` response if present.
- Should we **persist sanitized HARs** for support/audit? — TBD with security team.
