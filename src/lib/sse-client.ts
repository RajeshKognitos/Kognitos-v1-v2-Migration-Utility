/**
 * Server-Sent-Events helpers + shared wire types for the migration pipeline.
 *
 * This module is environment-agnostic (no `'use client'`): the API route imports
 * the event/result *types* from here, while browser components import the
 * {@link consumeMigrationStream} async iterator to read the live pipeline feed.
 *
 * Strict TS, no `any`.
 */

import type {
  CallGraph,
  ExtractedProcess,
  ExtractionWarning,
} from '@/lib/har';
import type { V1ProcessIR } from '@/types/ir';
import type { ConnectionRequirement, GroupSopResult } from '@/types/sop';

/** Aggregated token usage + computed USD cost for one pipeline stage. */
export interface StageTokenUsage {
  /** Sum of input (prompt) tokens. */
  totalInput: number;
  /** Sum of output (completion) tokens. */
  totalOutput: number;
  /** Computed cost in USD. */
  totalCostUsd: number;
}

/** A per-process failure surfaced from the analyzer. */
export interface StageError {
  /** Procedure ID that failed. */
  procedureId: string;
  /** Human-readable procedure name. */
  procedureName: string;
  /** The failure message. */
  error: string;
}

/** A per-group failure surfaced from the SOP orchestrator. */
export interface GroupStageError {
  /** Group id that failed. */
  groupId: string;
  /** Entry-point process name of the failed group. */
  entryName: string;
  /** The failure message. */
  error: string;
}

/**
 * Fully-serialized pipeline result (Maps flattened to records) returned on the
 * `done` event and from `GET /api/migrate/[id]/result`. Safe to `JSON.stringify`.
 */
export interface MigrationResult {
  /** Stable id (client-generated; also the `/migration/[id]` route segment). */
  id: string;
  /** Extractor output, trimmed to what the UI renders. */
  bundle: {
    harFilename: string;
    departmentId: string | null;
    processCount: number;
    callGraph: CallGraph;
    detectedBooks: string[];
    warnings: ExtractionWarning[];
    processes: ExtractedProcess[];
  };
  /** Phase 1 analyzer output. */
  analysis: {
    tokenUsage: StageTokenUsage;
    totalMs: number;
    errors: StageError[];
    /** Validated IRs keyed by `procedureId`. */
    irsById: Record<string, V1ProcessIR>;
    /** Per-process analysis duration (ms), keyed by `procedureId`. */
    perProcessMs: Record<string, number>;
  };
  /** Phase 3 SOP + test-plan output (one consolidated SOP per process group). */
  sop: {
    tokenUsage: StageTokenUsage;
    totalMs: number;
    errors: GroupStageError[];
    /** Consolidated SOP results, one per connected process group. */
    groups: GroupSopResult[];
    /** Per-group SOP duration (ms), keyed by `groupId`. */
    perGroupMs: Record<string, number>;
    /** Deduplicated v2 Connection requirements across all groups. */
    aggregatedConnections: ConnectionRequirement[];
  };
}

/** Which pipeline stage an event/error belongs to. */
export type MigrationStage = 'extract' | 'analyze' | 'sop';

/** Discriminated union of every event the `/api/migrate` stream can emit. */
export type MigrationEvent =
  | { type: 'extract_started' }
  | {
      type: 'extract_complete';
      processCount: number;
      callGraph: CallGraph;
      books: string[];
    }
  | { type: 'analyze_started'; total: number }
  | {
      type: 'analyze_progress';
      procedureId: string;
      procedureName: string;
      durationMs: number;
      completed: number;
      total: number;
      failed: boolean;
    }
  | { type: 'analyze_complete'; tokenUsage: StageTokenUsage; totalMs: number }
  | { type: 'sop_started'; total: number }
  | {
      type: 'sop_progress';
      groupId: string;
      entryName: string;
      durationMs: number;
      completed: number;
      total: number;
      failed: boolean;
    }
  | { type: 'sop_complete'; tokenUsage: StageTokenUsage; totalMs: number }
  | { type: 'done'; id: string; finalResult: MigrationResult }
  | { type: 'error'; stage: MigrationStage; message: string };

/**
 * Consume an SSE `Response` body as a typed async iterable of
 * {@link MigrationEvent}. Parses `data: <json>\n\n` frames, tolerating partial
 * chunks across reads. Throws if the response has no readable body.
 *
 * @example
 * const res = await fetch('/api/migrate', { method: 'POST', body });
 * for await (const event of consumeMigrationStream(res)) { ... }
 */
export async function* consumeMigrationStream(
  response: Response,
): AsyncGenerator<MigrationEvent, void, unknown> {
  if (!response.body) {
    throw new Error('Response has no body to stream.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
    // Flush any trailing frame without a terminating blank line.
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Parse a single SSE frame's `data:` lines into a {@link MigrationEvent}. */
function parseFrame(frame: string): MigrationEvent | null {
  const dataLines = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join('\n')) as MigrationEvent;
  } catch {
    return null;
  }
}
