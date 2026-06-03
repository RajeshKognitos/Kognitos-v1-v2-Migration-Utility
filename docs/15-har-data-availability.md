# 15 — HAR Data Availability (per process)

**What data does a Kognitos v1 HAR actually contain about each process, and what
do we extract from it?**

This document is grounded in the real samples tested so far
(`samples/agent-bundles/01-vendor-helpdesk.har`). To regenerate the numbers for a
new HAR, run:

```bash
npx tsx scripts/probe-har.ts
```

It is a companion to `docs/12-input-specification.md` (the input contract) and
`src/lib/har/types.ts` (the canonical `ExtractedProcess` / `ExtractedAgentBundle`
shapes). Where this doc and code disagree, the code wins — surface the drift.

---

## 1. Where the data comes from

A HAR is a recording of the browser↔Kognitos network traffic captured while a
human clicks through the v1 app. All process data lives inside **GraphQL
responses**. The extractor (`src/lib/har/extractor.ts`) walks every entry, parses
the `operationName` + response `data`, and pulls from **three** operations:

| GraphQL operation | Consumed? | What we take |
|---|---|---|
| `procedureGroup` | ✅ | The full process source + metadata (the main payload) |
| `listProcedureGroupsByDepartment` | ✅ | The list of every process ID in the agent (to detect gaps — MR-45) |
| `GetDepartmentUnpublishedChanges` | ✅ | Installed / learned custom integrations |

### Operation census from the sample (`01-vendor-helpdesk.har`, 126 entries)

| Operation | Count | Status |
|---|---|---|
| `proceduresMetric` | 49 | ignored (aggregate metrics) |
| `procedureGroup` | 14 | **consumed** |
| `listProcedureGroupsByDepartment` | 14 | **consumed** |
| `GetDepartmentUnpublishedChanges` | 14 | **consumed** |
| `ListDepartmentCollaborators` | 14 | ignored (user list / PII) |
| `ListTestSuiteBenchmarkWorkersByProcedure` | 7 | ignored (empty in sample) |
| `GetVisualizationUrl` | 7 | ignored |
| `getUnhandledRequestMetric` | 7 | ignored (aggregate metrics) |

> The same operations repeat (one capture per process the user opened), which is
> why the consumed ops appear ~14×. The extractor dedupes by stable process ID.

---

## 2. Per-process data we extract (`ExtractedProcess`)

Each process becomes one `ExtractedProcess`. Availability is `(populated / total)`
in the sample (7 processes):

| Field | Type | Sample | Notes |
|---|---|---|---|
| `id` | string | 7/7 | Kognitos procedure ID, stable across DRAFT/PUBLISHED (MR-47). The graph key. |
| `name` | string | 7/7 | e.g. `"to process vendorhelpdesk emails"`. |
| `text` | string | 7/7 | **The full v1 DSL source** — the single most important field; drives analysis + SOPs. |
| `lineCount` | number | 7/7 | Derived from `text`. |
| `owner` | string \| null | 7/7 | Owner **email — PII** (MR-48). Present in the sample; may be null. |
| `stage` | `DRAFT`/`PUBLISHED` | 7/7 | All PUBLISHED here. PUBLISHED preferred when both exist (MR-42). |
| `version` | string | 7/7 | ISO timestamp of the process version. |
| `departmentId` | string | 7/7 | = the v1 **agent** ID (MR-46). |
| `language` | `'english'` | 7/7 | v1 is english-only. |
| `schedules` | `Schedule[]` | 1/7 | `{name, expression(cron), enabled}` — only on PUBLISHED with a trigger. |
| `latestRunData` | `RunSummary` \| null | **0/7** | Key exists on the raw object but is **null** in the sample (see §5). |
| `sourceHash` | string | 7/7 | sha256 of `text`, for report traceability. |
| `subprocessRefs` | `SubprocessRef[]` | 5 total | Inline `@{…}` calls to other processes (see §3). |

---

## 3. Subprocess references → the call graph

Inside `text`, calls to other processes appear as inline tokens:

```
@{"type": "procedure", "display": "process the DP numbers", "value": "<targetId>"}
```

Each parsed `SubprocessRef` carries `displayName`, `targetId`, `callType`
(`invoke` / `run` / `start_a_run`, inferred from the preceding verb),
`position {line, col}`, and `resolvableInBundle` (whether the target's source is
also in this HAR). These edges build the **call graph**:

| Call graph field | Sample | Meaning |
|---|---|---|
| `nodes` | 7 | One per extracted process. |
| `edges` | 5 | One per resolvable subprocess ref. |
| `roots` | 3 | No incoming edges — entry points / business processes. |
| `leaves` | 5 | No outgoing edges — utility processes. |
| `cycles` | 0 | Recursive chains (none here; flagged for review if present — MR-44). |

This is exactly the data behind the **Business Processes** grouping and the
per-group **Call Graph** sub-tab.

---

## 4. Bundle-level data (`ExtractedAgentBundle`)

| Field | Sample value |
|---|---|
| `sourceMeta.departmentId` | `a0jbrrmjasqluvr2qlnh0dsnw` |
| `processes` | 7 |
| `detectedBooks` | `email, idp, sap, servicenow` (naive keyword hits; refined by the analyzer) |
| `callGraph` | 7 nodes / 5 edges / 3 roots / 5 leaves / 0 cycles |
| `warnings` | `STAGE_PREFERENCE_PUBLISHED ×7`, `MISSING_PROCESS_TEXT ×2` |

`MISSING_PROCESS_TEXT ×2`: the department listing named 2 more processes whose
source was never opened during capture, so their `text` isn't in the HAR. They
appear as warnings prompting a recapture (MR-45).

---

## 5. What is present in the HAR but NOT extracted

The raw `procedureGroup` object exposes more keys than we use. Available but
currently **ignored**:

`__typename`, `assignmentPolicy`, `departmentVersion`, `disabledAt`,
`disabledBy`, `knowledgeId`, `notificationRecipients`, `renameEnabled`, `title`.

Other ignored operations that *do* carry data:

- **`ListDepartmentCollaborators`** — 19 users (names/emails). **PII**; deliberately
  not extracted.
- **`proceduresMetric` / `getUnhandledRequestMetric`** — usage metrics, but only
  **day-aggregated counts** (e.g. `totalRuns: [{date, count}, …]`,
  `unhandledRequest: [{date, count}, …]`). No per-run inputs/outputs.
- **`ListTestSuiteBenchmarkWorkersByProcedure`** — v1 test suites. **Empty** (`items: []`)
  in the sample.

### Implication for test-data generation

There are **no real run inputs/outputs or saved test cases** in these HARs — only
aggregate run counts and an empty test-suite list. So test plans cannot be
"inspired" by real sample runs from this capture; they are generated
synthetically from the process IR (`sample_from_ir`). If a future HAR is captured
with the v1 *Test Suite* tab open and populated, `ListTestSuiteBenchmarkWorkers…`
would become a real source of seed test data worth wiring in.

---

## 6. Security note

Per MR-41, the HAR is sanitized **before** extraction: auth headers, cookies, and
tokens are redacted in place. No credentials are persisted. (The entry *count* is
unchanged — sanitization scrubs fields, it doesn't drop Kognitos entries.)
