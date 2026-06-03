/**
 * Type definitions for the HAR Extractor (Phase 0.5).
 *
 * Two families of types live here:
 *  1. HAR wire-format types — the minimal shape of an HTTP Archive file that
 *     this module reads/sanitizes. Intentionally permissive (open index
 *     signatures) because real HARs carry many fields we never touch.
 *  2. Extracted bundle types — the normalized output of extraction, per
 *     `docs/12-input-specification.md` Section 4.1.
 */

// ---------------------------------------------------------------------------
// HAR wire-format (subset we consume)
// ---------------------------------------------------------------------------

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarQueryParam {
  name: string;
  value: string;
}

export interface HarCookie {
  name: string;
  value: string;
  // Cookies carry assorted optional attributes (path, expires, httpOnly...).
  [key: string]: unknown;
}

export interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: unknown[];
}

export interface HarContent {
  size?: number;
  mimeType?: string;
  text?: string;
  encoding?: string;
}

export interface HarRequest {
  method: string;
  url: string;
  headers: HarHeader[];
  queryString: HarQueryParam[];
  cookies?: HarCookie[];
  postData?: HarPostData;
  [key: string]: unknown;
}

export interface HarResponse {
  status: number;
  headers: HarHeader[];
  cookies?: HarCookie[];
  content: HarContent;
  [key: string]: unknown;
}

export interface HarEntry {
  request: HarRequest;
  response: HarResponse;
  [key: string]: unknown;
}

export interface HarLog {
  entries: HarEntry[];
  [key: string]: unknown;
}

export interface HarFile {
  log: HarLog;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Extracted bundle types (spec Section 4.1)
// ---------------------------------------------------------------------------

export type Stage = 'DRAFT' | 'PUBLISHED';

/** How a parent process invokes a child (spec Section 4.3). */
export type CallType = 'invoke' | 'run' | 'start_a_run';

/** Publish schedule attached to a PUBLISHED procedure (v1 cron expression). */
export interface Schedule {
  name: string;
  expression: string;
  enabled: boolean;
}

/** Summary of the most recent run of a procedure (`latestRunData`). */
export interface RunSummary {
  id: string;
  triggeredAt: string;
  status: string;
}

/** A parsed inline `@{...}` subprocess reference within a process's source. */
export interface SubprocessRef {
  displayName: string;
  targetId: string;
  callType: CallType;
  /** true when `targetId` resolves to a process present in this bundle. */
  resolvableInBundle: boolean;
  position: { line: number; col: number };
}

export interface ExtractedProcess {
  /** Kognitos procedure ID (stable across DRAFT/PUBLISHED — see MR-47). */
  id: string;
  /** e.g. "to process invoices". */
  name: string;
  /** Owner email — PII, see MR-48. */
  owner: string | null;
  stage: Stage;
  /** ISO timestamp of the v1 process version. */
  version: string;
  /** v1 agent identifier (see MR-46). */
  departmentId: string;
  language: 'english';
  /** Full v1 DSL source. */
  text: string;
  lineCount: number;
  /** Populated for PUBLISHED procedures; empty otherwise. */
  schedules: Schedule[];
  latestRunData: RunSummary | null;
  /** sha256 of `text`, for traceability in the migration report. */
  sourceHash: string;
  /** Inline `@{...}` references parsed from `text`. */
  subprocessRefs: SubprocessRef[];
}

export interface CallGraphNode {
  id: string;
  name: string;
}

export interface CallGraphEdge {
  from: string;
  to: string;
  callType: string;
}

export interface CallGraph {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
  /** Process IDs with no incoming edges (likely entry points / roots). */
  roots: string[];
  /** Process IDs with no outgoing edges (utilities / leaves). */
  leaves: string[];
  /** Detected cycles (recursive call chains). Each inner array is one cycle. */
  cycles: string[][];
}

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface ExtractionWarning {
  severity: WarningSeverity;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Well-known warning/info codes emitted by the extractor. Codes are typed as
 * plain `string` on `ExtractionWarning` for forward-compatibility; this object
 * gives callers and tests a single source of truth for the canonical values.
 */
export const EXTRACTION_WARNING_CODES = {
  /** A subprocess `@{...}` ref points to an ID not present in the bundle (MR-43). */
  MISSING_SUBPROCESS_IN_HAR: 'MISSING_SUBPROCESS_IN_HAR',
  /** A process was listed by the department listing but its text was never captured (MR-45). */
  MISSING_PROCESS_TEXT: 'MISSING_PROCESS_TEXT',
  /** A recursive call chain was detected; needs human review for ordering (MR-44). */
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  /** Both DRAFT and PUBLISHED had text; PUBLISHED was chosen (MR-42). */
  STAGE_PREFERENCE_PUBLISHED: 'STAGE_PREFERENCE_PUBLISHED',
  /** No `departmentId` could be determined from the HAR (MR-46). */
  NO_DEPARTMENT_ID: 'NO_DEPARTMENT_ID',
} as const;

export type ExtractionWarningCode =
  (typeof EXTRACTION_WARNING_CODES)[keyof typeof EXTRACTION_WARNING_CODES];

export interface ExtractedAgentBundle {
  sourceMeta: {
    harFilename: string;
    extractedAt: string;
    extractorVersion: string;
    /** = v1 agent ID (see MR-46). */
    departmentId: string | null;
  };
  processes: ExtractedProcess[];
  callGraph: CallGraph;
  /** Naive book-detection hits; refined later by the parser + mapping (Section 4.4). */
  detectedBooks: string[];
  warnings: ExtractionWarning[];
}
