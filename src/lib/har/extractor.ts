/**
 * GraphQL response extraction (spec Section 4.2).
 *
 * Walks the (already-sanitized) HAR entries and pulls structured data out of
 * three Kognitos GraphQL operations:
 *   - `procedureGroup`                  → full process source (REQUIRED)
 *   - `listProcedureGroupsByDepartment` → all process IDs in the agent
 *   - `GetDepartmentUnpublishedChanges` → installed/learned integrations
 *
 * Subprocess `@{...}` references are parsed here too (Section 4.3), with
 * `resolvableInBundle` resolved once every procedure has been collected.
 *
 * Implements MR-42 (prefer published), MR-45 (cross-ref listing for missing
 * text), MR-46 (departmentId = agent ID), MR-47 (dedupe by stable ID).
 */

import { createHash } from 'node:crypto';
import {
  EXTRACTION_WARNING_CODES,
  type CallType,
  type ExtractedProcess,
  type ExtractionWarning,
  type HarEntry,
  type HarFile,
  type RunSummary,
  type Schedule,
  type Stage,
  type SubprocessRef,
} from './types';

/** Result of walking the HAR; consumed by the public extractor in `index.ts`. */
export interface ExtractionResult {
  processes: ExtractedProcess[];
  /** v1 agent ID (MR-46), or null if none could be found. */
  departmentId: string | null;
  /** Every process ID the department listing reported (MR-45). */
  listedProcedureIds: { id: string; name: string }[];
  /** Names of installed/learned integrations from unpublished-changes. */
  installedIntegrations: string[];
  warnings: ExtractionWarning[];
}

/**
 * Inline subprocess reference, verified against the real HAR:
 * `@{"type": "procedure", "display": "...", "value": "ID"}`
 */
const SUBPROCESS_REF_RE =
  /@\{"type":\s*"procedure",\s*"display":\s*"([^"]+)",\s*"value":\s*"([^"]+)"\}/g;

// ---------------------------------------------------------------------------
// Tiny structural narrowers — keep the JSON walk strict without `any`.
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** One GraphQL op paired with its response `data` object. */
interface OperationResult {
  operationName: string;
  data: Record<string, unknown>;
}

/**
 * Normalize a HAR entry into zero or more (operationName, data) pairs.
 * Handles both single GraphQL requests and batched (array) requests, aligning
 * the response array to the request array by index.
 */
function getOperationResults(entry: HarEntry): OperationResult[] {
  const url = entry?.request?.url;
  if (!url || !/graphql/i.test(url)) return [];

  const reqText = entry.request.postData?.text;
  const resText = entry.response?.content?.text;
  if (typeof reqText !== 'string' || typeof resText !== 'string') return [];

  let reqParsed: unknown;
  let resParsed: unknown;
  try {
    reqParsed = JSON.parse(reqText);
    resParsed = JSON.parse(resText);
  } catch {
    return [];
  }

  const reqs = Array.isArray(reqParsed) ? reqParsed : [reqParsed];
  const ress = Array.isArray(resParsed) ? resParsed : [resParsed];

  const results: OperationResult[] = [];
  for (let i = 0; i < reqs.length; i += 1) {
    const req = asRecord(reqs[i]);
    const operationName = req && asString(req.operationName);
    if (!operationName) continue;
    const res = asRecord(ress[i]);
    const data = res && asRecord(res.data);
    if (!data) continue;
    results.push({ operationName, data });
  }
  return results;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Parse inline `@{...}` subprocess references out of a process's source. */
export function parseSubprocessRefs(text: string): SubprocessRef[] {
  const refs: SubprocessRef[] = [];
  SUBPROCESS_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SUBPROCESS_REF_RE.exec(text)) !== null) {
    const [, displayName, targetId] = match;
    const lineStart = text.lastIndexOf('\n', match.index - 1) + 1;
    const before = text.slice(lineStart, match.index);
    const line = text.slice(0, match.index).split('\n').length; // 1-based
    const col = match.index - lineStart + 1; // 1-based column
    refs.push({
      displayName,
      targetId,
      callType: detectCallType(before),
      // Resolved later in the parent, once all procedures are known.
      resolvableInBundle: false,
      position: { line, col },
    });
  }
  return refs;
}

/**
 * Detect call type from the text immediately preceding `@{...}` on the same
 * line (Section 4.3). `invoke`/`run` are immediate verbs; `start a run ... the
 * procedure is @{...}` is contextual. Defaults to `run` (the common form).
 */
function detectCallType(before: string): CallType {
  if (/\binvoke\s*$/i.test(before)) return 'invoke';
  if (/\brun\s*$/i.test(before)) return 'run';
  if (/start a run/i.test(before) || /the procedure is\s*$/i.test(before)) {
    return 'start_a_run';
  }
  return 'run';
}

function parseSchedules(raw: unknown): Schedule[] {
  return asArray(raw)
    .map((item) => {
      const s = asRecord(item);
      if (!s) return null;
      const name = asString(s.name);
      const expression = asString(s.expression);
      if (name === null || expression === null) return null;
      return { name, expression, enabled: asBoolean(s.enabled, true) };
    })
    .filter((s): s is Schedule => s !== null);
}

function parseRunSummary(raw: unknown): RunSummary | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = asString(r.id);
  const triggeredAt = asString(r.triggeredAt);
  const status = asString(r.status);
  if (id === null || triggeredAt === null || status === null) return null;
  return { id, triggeredAt, status };
}

/** Build an `ExtractedProcess` from a raw v1 Procedure object that has text. */
function toExtractedProcess(
  proc: Record<string, unknown>,
  text: string,
): ExtractedProcess | null {
  const id = asString(proc.id);
  const departmentId = asString(proc.departmentId);
  const name = asString(proc.name);
  if (id === null || name === null) return null;

  const stage: Stage = proc.stage === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';

  return {
    id,
    name,
    owner: asString(proc.owner),
    stage,
    version: asString(proc.version) ?? '',
    departmentId: departmentId ?? '',
    // v2 IR only supports english; v1 verified to be english-only here.
    language: 'english',
    text,
    lineCount: text.split('\n').length,
    schedules: stage === 'PUBLISHED' ? parseSchedules(proc.schedules) : [],
    latestRunData: parseRunSummary(proc.latestRunData),
    sourceHash: sha256(text),
    subprocessRefs: parseSubprocessRefs(text),
  };
}

/**
 * Apply MR-42: choose published when it has text; fall back to draft. Returns
 * the chosen raw procedure + its text, and whether both stages had text (which
 * the caller records as an info warning).
 */
function chooseStage(procedureGroup: Record<string, unknown>): {
  chosen: Record<string, unknown>;
  text: string;
  bothHadText: boolean;
} | null {
  const draft = asRecord(procedureGroup.draftProcedure);
  const published = asRecord(procedureGroup.publishedProcedure);
  const draftText = draft && asString(draft.text);
  const publishedText = published && asString(published.text);

  const bothHadText = Boolean(draftText) && Boolean(publishedText);

  if (published && publishedText) {
    return { chosen: published, text: publishedText, bothHadText };
  }
  if (draft && draftText) {
    return { chosen: draft, text: draftText, bothHadText };
  }
  return null;
}

function handleProcedureGroup(
  data: Record<string, unknown>,
  byId: Map<string, ExtractedProcess>,
  bothStagesHadText: Set<string>,
): void {
  const pg = asRecord(data.procedureGroup);
  if (!pg) return;

  const choice = chooseStage(pg);
  if (!choice) return; // neither stage had text — nothing to extract here.

  const proc = toExtractedProcess(choice.chosen, choice.text);
  if (!proc) return;

  const existing = byId.get(proc.id);
  // MR-47: same ID across stages → dedupe, preferring the PUBLISHED capture.
  if (!existing || (existing.stage !== 'PUBLISHED' && proc.stage === 'PUBLISHED')) {
    byId.set(proc.id, proc);
  }

  // Track once per ID; the HAR repeats identical procedureGroup responses.
  if (choice.bothHadText) bothStagesHadText.add(proc.id);
}

/** Pull the listing items regardless of the v1/v2 response key shape. */
function handleListing(
  data: Record<string, unknown>,
  listed: Map<string, string>,
): void {
  const container =
    asRecord(data.listProcedureGroupsByDepartmentv2) ??
    asRecord(data.listProcedureGroupsByDepartment);
  if (!container) return;

  for (const item of asArray(container.items)) {
    const group = asRecord(item);
    if (!group) continue;
    const proc =
      asRecord(group.publishedProcedure) ?? asRecord(group.draftProcedure);
    if (!proc) continue;
    const id = asString(proc.id);
    const name = asString(proc.name);
    if (id !== null) listed.set(id, name ?? id);
  }
}

function handleUnpublishedChanges(
  data: Record<string, unknown>,
  integrations: Set<string>,
): void {
  const root = asRecord(data.getDepartmentUnpublishedChanges);
  if (!root) return;
  const learned = asRecord(root.learnedIntegrations);
  if (!learned) return;

  for (const bucket of ['createdEntities', 'updatedEntities']) {
    for (const entity of asArray(learned[bucket])) {
      const e = asRecord(entity);
      const name = e && asString(e.name);
      if (name) integrations.add(name);
    }
  }
}

/**
 * Walk a sanitized HAR and extract procedures, the department listing, and
 * installed integrations. Pure with respect to the input (does not mutate it).
 */
export function extractFromHar(har: HarFile): ExtractionResult {
  const byId = new Map<string, ExtractedProcess>();
  const listed = new Map<string, string>();
  const integrations = new Set<string>();
  const bothStagesHadText = new Set<string>();
  const warnings: ExtractionWarning[] = [];

  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  for (const entry of entries) {
    for (const { operationName, data } of getOperationResults(entry)) {
      if (operationName === 'procedureGroup') {
        handleProcedureGroup(data, byId, bothStagesHadText);
      } else if (operationName === 'listProcedureGroupsByDepartment') {
        handleListing(data, listed);
      } else if (operationName === 'GetDepartmentUnpublishedChanges') {
        handleUnpublishedChanges(data, integrations);
      }
    }
  }

  const processes = [...byId.values()];

  // Resolve subprocess refs now that every procedure ID is known.
  const knownIds = new Set(processes.map((p) => p.id));
  for (const proc of processes) {
    for (const ref of proc.subprocessRefs) {
      ref.resolvableInBundle = knownIds.has(ref.targetId);
    }
  }

  // MR-42: note (once per process) where PUBLISHED was chosen over DRAFT.
  for (const proc of processes) {
    if (bothStagesHadText.has(proc.id)) {
      warnings.push({
        severity: 'info',
        code: EXTRACTION_WARNING_CODES.STAGE_PREFERENCE_PUBLISHED,
        message: `Both DRAFT and PUBLISHED had source for "${proc.name}"; used PUBLISHED (MR-42).`,
        context: { procedureId: proc.id },
      });
    }
  }

  // MR-46: departmentId from any captured procedure, else from the listing.
  const departmentId: string | null =
    processes.find((p) => p.departmentId)?.departmentId ?? null;

  // MR-45: processes listed by the department but never captured with text.
  for (const [id, name] of listed) {
    if (!knownIds.has(id)) {
      warnings.push({
        severity: 'warning',
        code: EXTRACTION_WARNING_CODES.MISSING_PROCESS_TEXT,
        message: `Process "${name}" is listed in the agent but its source was not captured in this HAR. Open it in v1 and recapture.`,
        context: { procedureId: id },
      });
    }
  }

  if (departmentId === null) {
    warnings.push({
      severity: 'warning',
      code: EXTRACTION_WARNING_CODES.NO_DEPARTMENT_ID,
      message:
        'Could not determine a departmentId (v1 agent ID) from this HAR.',
    });
  }

  return {
    processes,
    departmentId,
    listedProcedureIds: [...listed].map(([id, name]) => ({ id, name })),
    installedIntegrations: [...integrations],
    warnings,
  };
}
