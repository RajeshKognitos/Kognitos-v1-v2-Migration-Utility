/**
 * SOP + Test Plan types (Phase 3).
 *
 * Canonical, typed output of the SOP/Test-Plan generator. The `TestPlan` family
 * mirrors `docs/10-test-plan-generation-spec.md` Section 3 verbatim; the runtime
 * Zod schemas in `src/lib/sop/schema.ts` are kept structurally identical so
 * drift is caught at compile time.
 *
 * Strict TS, no `any`. Every export is documented.
 */

// ============================================================
// Test Plan (docs/10 Section 3)
// ============================================================

/** A structured plan the autonomous agent (Phase 5) executes to validate a v2 Automation. */
export interface TestPlan {
  /** Human-readable process name this plan covers. */
  processName: string;
  /** ISO-8601 timestamp of generation. */
  generatedAt: string;
  /** Ordered test cases (≥1 happy path, ≥1 edge, ≥1 error — see coverage rules). */
  testCases: TestCase[];
  /** How the agent decides overall pass/fail. */
  validationStrategy: ValidationStrategy;
  /** Human-readable setup steps required before running (e.g. Connections). */
  prerequisites: string[];
}

/** Category of a {@link TestCase}. */
export type TestCaseCategory =
  | 'happy_path'
  | 'edge_case'
  | 'error_case'
  | 'integration';

/** Execution priority of a {@link TestCase}. */
export type TestCasePriority = 'critical' | 'high' | 'medium' | 'low';

/** A single test scenario: inputs, expected outputs, and behavior assertions. */
export interface TestCase {
  /** Stable identifier, e.g. `"tc_001"`. */
  id: string;
  /** `[category] - [scenario]`, e.g. `"Happy path - standard invoice"`. */
  name: string;
  /** What this case tests and why. */
  description: string;
  /** Coverage category. */
  category: TestCaseCategory;
  /** Execution priority. */
  priority: TestCasePriority;
  /** Inputs supplied to the Automation, keyed by input name. */
  inputs: Record<string, TestInput>;
  /** Expected outputs, keyed by output name. */
  expectedOutputs: Record<string, ExpectedValue>;
  /** Behavioral assertions (integration called, exception raised, …). */
  expectedBehavior: BehaviorAssertion[];
  /** Files to upload before running, when the process consumes files. */
  files?: TestFile[];
  /** v2 setup steps to perform before running. */
  setup?: string[];
  /** Cleanup steps to perform after running. */
  teardown?: string[];
}

/** A single input value for a {@link TestCase}. */
export interface TestInput {
  /** Value type. */
  type: 'text' | 'number' | 'boolean' | 'date' | 'file' | 'list' | 'table';
  /**
   * The value itself (shape depends on `type`). Optional because `unknown`
   * already admits `undefined` and JSON may omit it; callers should still
   * supply one for a meaningful test case.
   */
  value?: unknown;
  /** How the value was sourced. */
  source: 'synthetic' | 'sample_from_ir' | 'human_provided';
}

/** An expected output value plus the matcher used to verify it. */
export interface ExpectedValue {
  /** Matcher applied against the actual output. */
  matcher:
    | 'equals'
    | 'contains'
    | 'matches_regex'
    | 'is_type'
    | 'in_range'
    | 'is_present';
  /** Comparison operand (omitted for `is_present`). */
  value?: unknown;
  /** Why this expectation matters. */
  notes?: string;
}

/** A non-output behavioral assertion about a run. */
export interface BehaviorAssertion {
  /** Assertion kind. */
  type:
    | 'integration_called'
    | 'exception_raised'
    | 'no_exception'
    | 'output_within_time';
  /** Human-readable description of the assertion. */
  description: string;
  /** Structured assertion parameters (e.g. `{ integration: "Email" }`). */
  details: Record<string, unknown>;
}

/** A file the agent must provide before running a {@link TestCase}. */
export interface TestFile {
  /** Filename used in v2. */
  name: string;
  /** File type. */
  type: 'pdf' | 'csv' | 'xlsx' | 'docx' | 'image' | 'text';
  /** Where the file comes from. */
  source: 'sample_repo' | 'synthetic' | 'upload_required';
  /** Path within the sample repo, when `source` is `sample_repo`. */
  path?: string;
  /** What the file represents / should contain. */
  description: string;
}

/** How the agent decides overall pass/fail for a {@link TestPlan}. */
export interface ValidationStrategy {
  /** The dominant signal of success. */
  primaryAssertion:
    | 'output_match'
    | 'integration_call_sequence'
    | 'state_change'
    | 'no_exception';
  /** Additional verifications to run. */
  secondaryChecks: string[];
  /** Acceptable variations (timing, formatting, …). */
  toleranceNotes?: string;
}

// ============================================================
// Connection requirements
// ============================================================

/** A v2 Connection/Integration the migrated Automation requires. */
export interface ConnectionRequirement {
  /** v2 Integration name (per `docs/06-book-integration-mapping.csv`). */
  integration: string;
  /** Why this Connection is needed (which actions use it). */
  reason: string;
  /** v2 docs URL for setting up this Integration, when known. */
  setupUrl?: string;
  /**
   * True for Integrations whose actions must be DISCOVERED in-product
   * (SAP, NetSuite, Salesforce) rather than blindly remapped.
   */
  isCustomActionsIntegration: boolean;
}

// ============================================================
// Generator result
// ============================================================

/** The complete output of generating an SOP + test plan for one process. */
export interface SopGenerationResult {
  /** v2-ready conversational SOP, as Markdown. */
  sop: string;
  /** Validated structured test plan. */
  testPlan: TestPlan;
  /** Every v2 Connection the process requires. */
  connectionRequirements: ConnectionRequirement[];
  /** Deterministic, code-stamped provenance (never trusted from the model). */
  metadata: SopGenerationMetadata;
}

/** Provenance for one {@link SopGenerationResult}; stamped by code. */
export interface SopGenerationMetadata {
  /** ISO-8601 timestamp of generation. */
  generatedAt: string;
  /** Semantic version of the SOP generator that produced this result. */
  sopGeneratorVersion: string;
  /** Token usage (summed across the first attempt and optional retry). */
  tokensUsed: { input: number; output: number };
}
