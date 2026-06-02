# End-State Migration Report — Format Spec

> Defines the structured output the migration utility generates after each migration (per-process or batch).

---

## 1. Purpose

The report is the **proof of migration**. It tells:
- What was migrated
- How long it took
- What decisions were made (auto vs human)
- What issues arose and how they were resolved
- Where the resulting v2 Automation lives
- What still needs human attention (if anything)

It must be both **machine-readable** (JSON) and **human-readable** (rendered HTML/Markdown).

---

## 2. Report Schema

```typescript
interface MigrationReport {
  // Identification
  reportId: string;                       // UUID
  generatedAt: string;                    // ISO timestamp
  reportType: 'single' | 'batch';
  utilityVersion: string;                 // e.g. "0.1.0"

  // Scope
  scope: {
    organizationId: string;
    workspaceId: string;
    processCount: number;
    initiatedBy: string;                  // user identifier
  };

  // Summary
  summary: {
    totalProcesses: number;
    successful: number;
    partiallyMigrated: number;            // published but with warnings
    failed: number;
    needsHumanReview: number;
    totalDurationMs: number;
    totalApiCallsMade: number;
    totalClaudeTokensUsed: number;
  };

  // Per-process details
  processes: ProcessMigrationResult[];

  // Aggregate insights
  insights: ReportInsights;
}

interface ProcessMigrationResult {
  v1ProcessId: string;
  v1ProcessName: string;                  // from `to ...` line
  v1SourceLines: number;
  v1SourceHash: string;                   // for traceability

  // Status
  status: 'success' | 'partial' | 'failed' | 'needs_human';
  startTime: string;
  endTime: string;
  durationMs: number;

  // v2 result
  v2Automation?: {
    id: string;
    displayName: string;
    workspaceId: string;
    publishedVersion: string | null;
    activationState: 'ACTIVE' | 'DEACTIVATED' | 'UNSPECIFIED';
    automationUrl: string;                // deep link to v2 UI
  };

  // Pipeline artifacts
  artifacts: {
    irHash: string;                       // for reproducibility
    sopExcerpt: string;                   // first 500 chars
    testPlanSummary: {
      totalTestCases: number;
      categories: Record<string, number>;
    };
  };

  // Detailed activity timeline
  timeline: TimelineEvent[];

  // Test results
  testResults: TestResultSummary[];

  // Issues encountered
  issues: Issue[];

  // Migration flags from IR
  flagsRaised: FlagSummary[];

  // Human interventions (if any)
  humanInterventions: HumanIntervention[];

  // Books/Integrations involved
  integrations: {
    v1Books: string[];
    v2Integrations: string[];
    customActionsRequired: string[];
    customBdkRedeployRequired: string[];
    noEquivalentFound: string[];
  };

  // Exceptions handled
  exceptionsHandled: ExceptionRecord[];

  // What to do next (human action items)
  recommendedNextSteps: string[];
}

interface TimelineEvent {
  timestamp: string;
  type: 'state_change' | 'api_call' | 'test_run' | 'exception' | 'human_intervention';
  state: string;
  durationMs?: number;
  details: Record<string, unknown>;
}

interface TestResultSummary {
  testCaseId: string;
  testCaseName: string;
  category: 'happy_path' | 'edge_case' | 'error_case' | 'integration';
  passed: boolean;
  runId: string;
  runUrl: string;                         // deep link to v2 run view
  durationMs: number;
  failureReason?: string;
  retryCount: number;
}

interface Issue {
  severity: 'error' | 'warning' | 'info';
  category: 'parser' | 'mapping' | 'sop_generation' | 'agent' | 'api' | 'test';
  code: string;                           // e.g. "PARALLEL_SUBPROCESS_NO_EQUIVALENT"
  message: string;
  context?: Record<string, unknown>;
  recommendation?: string;
}

interface FlagSummary {
  code: string;                           // from migration rules
  count: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  resolved: boolean;
  resolutionNote?: string;
}

interface HumanIntervention {
  timestamp: string;
  triggerReason: string;
  resolvedBy: string;
  resolutionType: 'continue' | 'override' | 'abandon';
  notes?: string;
  durationMs: number;                     // time agent was paused
}

interface ExceptionRecord {
  exceptionId: string;
  type: 'system' | 'configuration' | 'value' | 'validation';
  description: string;
  raisedAt: string;
  resolved: boolean;
  resolutionAttempts: number;
  resolutionMethod: 'automated' | 'human' | 'unresolved';
  troubleshootingGuideCreated: boolean;
  resolutionTimeMs: number;
}

interface ReportInsights {
  mostCommonFlags: { code: string; count: number }[];
  mostFailedIntegrations: { integration: string; failureCount: number }[];
  averageMigrationTimeMs: number;
  successRatePercent: number;
  patternsDetected: string[];             // e.g. "All Salesforce processes need Custom Action discovery"
  costEstimate: {
    claudeTokens: number;
    claudeCostUsd: number;
    kognitosApiCalls: number;
  };
}
```

---

## 3. Report Rendering

### Format 1: JSON (machine-readable)
- Saved to persistence as the source of truth
- Downloadable via `/api/report/{reportId}` (GET, Accept: application/json)
- Used for programmatic post-processing or batch analytics

### Format 2: Markdown (human-readable)
- Generated from JSON via a template
- Downloadable via `/api/report/{reportId}.md`
- Suitable for sharing in PRs, Slack, email

### Format 3: HTML (rich UI)
- Rendered in the app at `/report/{reportId}`
- Interactive: collapsible sections, links to v2, charts
- Print-friendly CSS for PDF export

---

## 4. Markdown Template

```markdown
# Migration Report — {scope.workspaceId}

**Generated:** {generatedAt}
**Type:** {reportType}
**Processes:** {summary.totalProcesses}

## Summary

| Metric | Value |
|---|---|
| ✅ Successful | {summary.successful} |
| ⚠️ Partial | {summary.partiallyMigrated} |
| ❌ Failed | {summary.failed} |
| 👥 Needs Review | {summary.needsHumanReview} |
| ⏱ Total Time | {formatDuration(totalDurationMs)} |
| 💰 Claude Cost | ${insights.costEstimate.claudeCostUsd} |

## Key Insights

{insights.patternsDetected.map(p => `- ${p}`).join('\n')}

### Most Common Issues
{insights.mostCommonFlags.map(f => `- **${f.code}** (${f.count}x)`).join('\n')}

## Per-Process Results

{processes.map(renderProcessSection).join('\n\n')}

## Recommended Next Steps

{aggregateRecommendations(processes).map(r => `- [ ] ${r}`).join('\n')}
```

### Per-Process Section Template

```markdown
### {v1ProcessName}

**Status:** {statusEmoji(status)} {status.toUpperCase()}
**Duration:** {formatDuration(durationMs)}
**v2 Automation:** {v2Automation ? `[${v2Automation.displayName}](${v2Automation.automationUrl}) v${v2Automation.publishedVersion}` : '—'}

#### Test Results
| Test | Status | Duration |
|---|---|---|
{testResults.map(t => `| ${t.testCaseName} | ${t.passed ? '✅' : '❌'} | ${formatDuration(t.durationMs)} |`).join('\n')}

#### Integrations Used
- **v2 Integrations:** {integrations.v2Integrations.join(', ')}
- **Custom Actions Required:** {integrations.customActionsRequired.length > 0 ? integrations.customActionsRequired.join(', ') : 'None'}
- **No Equivalent Found:** {integrations.noEquivalentFound.length > 0 ? `⚠️ ${integrations.noEquivalentFound.join(', ')}` : 'None'}

#### Issues
{issues.length > 0 ? issues.map(i => `- **[${i.severity.toUpperCase()}]** ${i.message}`).join('\n') : '_No issues_'}

#### Recommended Next Steps
{recommendedNextSteps.map(r => `- [ ] ${r}`).join('\n')}
```

---

## 5. HTML Rendering (Components)

The HTML report is built with the same Next.js/Tailwind stack:

```
/src/app/report/[id]/page.tsx
  └─ Renders MigrationReport JSON as interactive HTML
     ├─ <ReportHeader />        ← scope + summary
     ├─ <InsightsPanel />       ← charts, patterns
     ├─ <ProcessList />         ← collapsible per-process cards
     │   └─ <ProcessCard />
     │       ├─ <TestResultsTable />
     │       ├─ <TimelineView />
     │       ├─ <IssuesList />
     │       └─ <NextSteps />
     └─ <ExportControls />      ← download JSON/MD/PDF
```

### Visual standards
- Status colors: green (success), yellow (partial), red (failed), blue (needs_review)
- Timeline rendered as vertical chronological list with type icons
- Test results show pass/fail badges + duration sparklines
- Issues collapsible by severity
- All v2 links open in new tab

---

## 6. Persistence

Reports are persisted indefinitely (immutable once generated):

```sql
-- SQLite schema (or KV-equivalent)
CREATE TABLE migration_reports (
  report_id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  status TEXT NOT NULL,                 -- 'completed', 'partial', 'failed'
  process_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE INDEX idx_reports_workspace ON migration_reports(workspace_id);
CREATE INDEX idx_reports_generated_at ON migration_reports(generated_at);
```

---

## 7. Listing & Discovery

Users can browse past reports:
- `/reports` → list view with filters (date, workspace, status)
- `/reports?workspace=X&status=failed` → filtered list
- Comparison view: `/reports/compare?ids=A,B` → diff two reports

---

## 8. Privacy & Security

- Reports contain v1 source excerpts → may include business logic
- **Do NOT include**: credentials, PII, customer data extracted in test runs
- Sanitize before persistence:
  - Strip API keys, OAuth tokens, password fields
  - Hash file contents (store hash, not content)
  - Replace email addresses with `[REDACTED_EMAIL]`
- Access control: only the org/workspace's authorized users can read

---

## 9. Aggregate Analytics (Future)

When we have many reports, surface trends:
- Migration velocity over time
- Most problematic integrations
- SOP generation quality metrics (which generations needed most clarifications)
- Parser robustness (what malformed inputs are most common)

These insights feed back into improving the utility itself.

---

## 10. Example Report (Abbreviated)

```json
{
  "reportId": "rpt_2026-06-02_15h22_abc123",
  "generatedAt": "2026-06-02T15:22:18Z",
  "reportType": "batch",
  "utilityVersion": "0.1.0",
  "scope": {
    "organizationId": "org_xyz",
    "workspaceId": "ws_finance",
    "processCount": 3,
    "initiatedBy": "rahul@company.com"
  },
  "summary": {
    "totalProcesses": 3,
    "successful": 2,
    "partiallyMigrated": 0,
    "failed": 0,
    "needsHumanReview": 1,
    "totalDurationMs": 487000,
    "totalApiCallsMade": 47,
    "totalClaudeTokensUsed": 38420
  },
  "processes": [
    {
      "v1ProcessId": "p_invoice_approval",
      "v1ProcessName": "to process invoice approvals",
      "v1SourceLines": 28,
      "v1SourceHash": "sha256:abc...",
      "status": "success",
      "startTime": "2026-06-02T15:20:00Z",
      "endTime": "2026-06-02T15:22:30Z",
      "durationMs": 150000,
      "v2Automation": {
        "id": "auto_xyz789",
        "displayName": "Invoice Approval Workflow",
        "workspaceId": "ws_finance",
        "publishedVersion": "1.0",
        "activationState": "ACTIVE",
        "automationUrl": "https://app.us-1.kognitos.com/.../auto_xyz789"
      },
      "testResults": [
        { "testCaseId": "tc_001", "testCaseName": "Happy path - small invoice", "passed": true, "category": "happy_path", "runId": "run_abc", "runUrl": "https://...", "durationMs": 12000, "retryCount": 0 }
      ],
      "issues": [],
      "flagsRaised": [
        { "code": "GET_SEMANTIC_PAUSE", "count": 2, "severity": "warning", "message": "Process uses `get` semantics", "resolved": true, "resolutionNote": "Documented in SOP as 'pause and ask' behavior" }
      ],
      "integrations": {
        "v1Books": ["email"],
        "v2Integrations": ["Email"],
        "customActionsRequired": [],
        "customBdkRedeployRequired": [],
        "noEquivalentFound": []
      },
      "recommendedNextSteps": []
    }
  ],
  "insights": {
    "mostCommonFlags": [
      { "code": "GET_SEMANTIC_PAUSE", "count": 5 }
    ],
    "mostFailedIntegrations": [],
    "averageMigrationTimeMs": 162333,
    "successRatePercent": 66.7,
    "patternsDetected": [
      "All processes successfully migrated except those using parallel subprocesses"
    ],
    "costEstimate": {
      "claudeTokens": 38420,
      "claudeCostUsd": 0.58,
      "kognitosApiCalls": 47
    }
  }
}
```
