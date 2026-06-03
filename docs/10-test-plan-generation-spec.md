# Test Plan Generation Spec

> How the generator produces a structured test plan alongside the SOP, and how the agent consumes it.

---

> **Update (Jun 2026) — consolidated, per-group test plans.** As of Decision #17,
> the SOP + test plan are generated **per connected process-group** (a
> weakly-connected component of the call graph), not per process. Each group
> yields **one end-to-end test plan** driven by the group's **entry-point**
> process: `testPlan.processName` is the entry business-process name, and the
> cases exercise the full flow through its sub-tasks. Disconnected processes form
> singleton groups (an individual plan each). Integration coverage spans **every**
> book/integration used **anywhere in the group**. The schema below is unchanged;
> only the unit (one plan per group) and the entry-point framing are new.

---

## 1. Purpose

A test plan is a structured artifact that tells the agent:
- **What inputs to try** (covering happy path + edge cases)
- **What outputs/behaviors to expect**
- **How to verify success**

Without a test plan, the agent has no way to validate that the v2 Automation correctly replicates the v1 process behavior.

---

## 2. Generation — Inputs to Claude

When generating the test plan, Claude receives:
1. The full IR (`V1ProcessIR`)
2. The generated SOP (the v2-ready NL description)
3. The Book→Integration mapping enrichment
4. The applicable Migration Rules flags from the IR

---

## 3. Test Plan Schema

```typescript
interface TestPlan {
  processName: string;
  generatedAt: string;
  testCases: TestCase[];
  validationStrategy: ValidationStrategy;
  prerequisites: string[];        // human-readable setup steps
}

interface TestCase {
  id: string;                     // "tc_001"
  name: string;                   // "Happy path - small invoice"
  description: string;            // what this case tests
  category: 'happy_path' | 'edge_case' | 'error_case' | 'integration';
  priority: 'critical' | 'high' | 'medium' | 'low';

  inputs: Record<string, TestInput>;
  expectedOutputs: Record<string, ExpectedValue>;
  expectedBehavior: BehaviorAssertion[];

  // Optional: files to upload before running
  files?: TestFile[];

  // Optional: setup steps in v2 before running
  setup?: string[];

  // Cleanup after run
  teardown?: string[];
}

interface TestInput {
  type: 'text' | 'number' | 'boolean' | 'date' | 'file' | 'list' | 'table';
  value: unknown;
  source: 'synthetic' | 'sample_from_ir' | 'human_provided';
}

interface ExpectedValue {
  matcher: 'equals' | 'contains' | 'matches_regex' | 'is_type' | 'in_range' | 'is_present';
  value?: unknown;
  notes?: string;                 // why this expectation matters
}

interface BehaviorAssertion {
  type: 'integration_called' | 'exception_raised' | 'no_exception' | 'output_within_time';
  description: string;
  details: Record<string, unknown>;
}

interface TestFile {
  name: string;                   // filename in v2
  type: 'pdf' | 'csv' | 'xlsx' | 'docx' | 'image' | 'text';
  source: 'sample_repo' | 'synthetic' | 'upload_required';
  path?: string;                  // if from sample_repo
  description: string;
}

interface ValidationStrategy {
  primaryAssertion: 'output_match' | 'integration_call_sequence' | 'state_change' | 'no_exception';
  secondaryChecks: string[];      // additional verifications
  toleranceNotes?: string;        // acceptable variations
}
```

---

## 4. Generation Rules

### Coverage Targets
For every process, generate **at minimum**:
- 1 happy path test case (critical priority)
- 1 edge case (high priority): boundary values, empty inputs, max sizes
- 1 error case (medium priority): exception-triggering input (`ask`/`get` semantics)
- 1 integration test (high priority): verifies each book in IR is called

### Test Case Naming
Format: `[category] - [scenario]`
Examples:
- "Happy path - standard invoice under threshold"
- "Edge case - empty document list"
- "Error case - missing required field triggers `get`"

### Input Generation Strategy
1. **Sample from IR:** If IR has literal values (e.g., `the threshold is 1000`), use those
2. **Synthetic realistic:** Generate plausible business values (e.g., invoice amounts like 1500.00, dates within last 30 days)
3. **Anonymized:** No real PII, real company names, real emails

### Edge Cases to Always Test
- Empty collections (loop with 0 items)
- Single-item collections
- Max-size inputs (per platform limits)
- Boundary values for numeric thresholds
- Missing optional fields
- Required field that triggers `ask`/`get` exception

### Integration-Specific Test Patterns
| Integration | Test pattern |
|---|---|
| Email | Send to test address, verify message format |
| Salesforce | Create test record, verify by ID, cleanup in teardown |
| SAP/NetSuite | Read-only operations preferred; flag writes for human review |
| Document Processing (IDP) | Use sample PDFs from `/samples/files/` |
| HTTP | Mock or use httpbin.org for safe testing |
| Database | Read against test DB only; never production |

### Files to Generate
If the process uses file inputs:
- Reference samples from `/samples/files/` directory (developer maintains)
- For each file type used, ensure at least 1 representative sample exists
- For complex extraction, include 2+ variations to test robustness

---

## 5. Claude Prompt Template

```
You are generating a structured test plan for a Kognitos v2 Automation that was migrated from a v1 process.

## v1 Process IR
{ir_json}

## Generated v2 SOP
{sop_text}

## Book→Integration Mappings
{mapping_summary}

## Migration Flags Active
{active_flags}

## Your Task
Generate a TestPlan JSON conforming to the schema in `docs/10-test-plan-generation-spec.md`.

Requirements:
1. At minimum: 1 happy path, 1 edge case, 1 error case, 1 integration test
2. Each test case must have:
   - Clear name and description
   - Realistic synthetic inputs (no real PII)
   - Specific expected outputs with matchers
   - Behavior assertions where applicable
3. Pay special attention to:
   - `get` vs `find` semantics (MR-2) → generate exception-triggering case
   - Custom Actions integrations → flag for one-time manual verification
   - Parallel subprocess (MR-19) → note that this case can't be auto-tested
4. Output ONLY valid JSON matching the TestPlan schema, no preamble or explanation.

## Output
{json_only}
```

---

## 6. Consumption by Agent

The agent (Phase 5) consumes the test plan:

```typescript
// In agent's "testing" state
async function runNextTestCase(context: AgentContext): Promise<TestResult> {
  const testCase = context.testPlan.testCases[context.currentTestCaseIndex];

  // 1. Setup: upload files if needed
  if (testCase.files) {
    for (const file of testCase.files) {
      await kognitos.uploadFile(file);
    }
  }

  // 2. Invoke
  const run = await kognitos.invokeAutomation(
    context.automationId,
    convertInputsToValues(testCase.inputs),
    'DRAFT'
  );

  // 3. Wait for terminal state
  const finalRun = await kognitos.waitForRunTerminal(
    context.automationId,
    run.id,
    { timeoutMs: 10 * 60 * 1000 }
  );

  // 4. Validate
  return validateRun(finalRun, testCase);
}

function validateRun(run: Run, testCase: TestCase): TestResult {
  const checks: ValidationResult[] = [];

  // Check expected outputs
  if (run.state.type === 'completed') {
    for (const [key, expected] of Object.entries(testCase.expectedOutputs)) {
      checks.push(matchOutput(run.outputs[key], expected));
    }
  }

  // Check behavior assertions
  for (const assertion of testCase.expectedBehavior) {
    checks.push(checkAssertion(run, assertion));
  }

  return {
    testCaseId: testCase.id,
    passed: checks.every(c => c.passed),
    runId: run.name,
    checks,
    duration: /* ... */,
  };
}
```

---

## 7. Validation Matchers

```typescript
function matchOutput(actual: unknown, expected: ExpectedValue): ValidationResult {
  switch (expected.matcher) {
    case 'equals':
      return { passed: deepEquals(actual, expected.value), actual, expected };

    case 'contains':
      return { passed: containsValue(actual, expected.value), actual, expected };

    case 'matches_regex':
      return { passed: new RegExp(expected.value as string).test(String(actual)), actual, expected };

    case 'is_type':
      return { passed: typeOf(actual) === expected.value, actual, expected };

    case 'in_range':
      const [min, max] = expected.value as [number, number];
      return { passed: typeof actual === 'number' && actual >= min && actual <= max, actual, expected };

    case 'is_present':
      return { passed: actual !== undefined && actual !== null, actual, expected };

    default:
      return { passed: false, error: `Unknown matcher: ${expected.matcher}` };
  }
}
```

---

## 8. Failure Reporting

When a test case fails:

```typescript
interface TestResult {
  testCaseId: string;
  passed: boolean;
  runId: string;
  duration: number;
  checks: ValidationResult[];

  // Failure context (when passed=false)
  failureType?: 'output_mismatch' | 'unexpected_exception' | 'timeout' | 'integration_error';
  failureSummary?: string;
  diagnostics?: {
    expectedOutputs: Record<string, unknown>;
    actualOutputs: Record<string, unknown>;
    runEvents: Event[];
    suggestedFix?: string;       // Claude-generated suggestion
  };
}
```

The agent uses `failureType` to decide next action:
- `output_mismatch` → likely SOP issue, try clarifying message
- `unexpected_exception` → enter `resolving_exception` state
- `timeout` → escalate
- `integration_error` → check Connection, escalate if persists

---

## 9. Example Test Plan

For the sample process `01-simple-email.txt`:

```json
{
  "processName": "Send Approval Email for Large Invoices",
  "generatedAt": "2026-06-02T12:00:00Z",
  "testCases": [
    {
      "id": "tc_001",
      "name": "Happy path - invoice below threshold",
      "description": "Invoice under threshold should not trigger approval email",
      "category": "happy_path",
      "priority": "critical",
      "inputs": {
        "invoice_total": { "type": "number", "value": 5000, "source": "synthetic" },
        "invoice_number": { "type": "text", "value": "INV-001", "source": "synthetic" }
      },
      "expectedOutputs": {
        "email_sent": { "matcher": "equals", "value": false }
      },
      "expectedBehavior": [
        { "type": "no_exception", "description": "No exceptions raised", "details": {} }
      ]
    },
    {
      "id": "tc_002",
      "name": "Happy path - invoice above threshold triggers email",
      "description": "Invoice over $10,000 should trigger approval email",
      "category": "happy_path",
      "priority": "critical",
      "inputs": {
        "invoice_total": { "type": "number", "value": 15000, "source": "synthetic" },
        "invoice_number": { "type": "text", "value": "INV-002", "source": "synthetic" }
      },
      "expectedOutputs": {
        "email_sent": { "matcher": "equals", "value": true }
      },
      "expectedBehavior": [
        {
          "type": "integration_called",
          "description": "Email integration was called",
          "details": { "integration": "Email", "action": "send" }
        }
      ]
    },
    {
      "id": "tc_003",
      "name": "Edge case - threshold boundary",
      "description": "Invoice exactly at $10,000 — verify whether boundary is inclusive or exclusive",
      "category": "edge_case",
      "priority": "high",
      "inputs": {
        "invoice_total": { "type": "number", "value": 10000, "source": "synthetic" },
        "invoice_number": { "type": "text", "value": "INV-003", "source": "synthetic" }
      },
      "expectedOutputs": {
        "email_sent": {
          "matcher": "is_present",
          "notes": "Boundary behavior should be confirmed against v1 semantics"
        }
      },
      "expectedBehavior": []
    }
  ],
  "validationStrategy": {
    "primaryAssertion": "output_match",
    "secondaryChecks": ["No unexpected exceptions raised"],
    "toleranceNotes": "Email send timing may vary"
  },
  "prerequisites": [
    "Email Integration Connection configured in v2 workspace",
    "Test recipient address available"
  ]
}
```
