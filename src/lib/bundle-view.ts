/**
 * View-model derivation for the bundle viewer (Phase 3.5).
 *
 * Pure functions that flatten a {@link MigrationResult} into per-process
 * `ProcessView`s the UI renders directly — books used, subprocess count, flag
 * list, call-graph role, plus the attached IR + SOP. Keeps the IR-walking logic
 * in one place instead of duplicated across components.
 *
 * Strict TS, no `any`.
 */

import type { Flag, StatementIR, V1ProcessIR } from '@/types/ir';
import type { ConnectionRequirement, SopGenerationResult } from '@/types/sop';
import type { MigrationResult } from '@/lib/sse-client';

/** A process's call-graph role, used for node/border coloring. */
export type ProcessRole = 'root' | 'leaf' | 'intermediate';

/** Everything the UI needs to render one process card / detail panel. */
export interface ProcessView {
  id: string;
  name: string;
  owner: string | null;
  stage: 'DRAFT' | 'PUBLISHED';
  lineCount: number;
  /** Original v1 DSL source. */
  source: string;
  /** Distinct v1 book keys used (from `book_usage` statements). */
  books: string[];
  /** Count of `subprocess_call` statements. */
  subprocessCount: number;
  /** All migration flags (file-level + procedure-level), most severe first. */
  flags: Flag[];
  /** Call-graph role. */
  role: ProcessRole;
  /** Analyzer IR, if analysis succeeded for this process. */
  ir?: V1ProcessIR;
  /** SOP + test plan + connections, if generation succeeded. */
  sop?: SopGenerationResult;
  /** True if analysis or SOP generation failed for this process. */
  failed: boolean;
}

const SEVERITY_RANK: Record<Flag['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Depth-first flatten of a statement tree (into conditionals + loops). */
function flatten(statements: StatementIR[]): StatementIR[] {
  return statements.flatMap((s) => {
    if (s.kind === 'conditional') {
      return [s, ...flatten(s.thenBranch), ...flatten(s.elseBranch ?? [])];
    }
    if (s.kind === 'loop') return [s, ...flatten(s.body)];
    return [s];
  });
}

/** Every statement across all procedures of an IR, flattened. */
function allStatements(ir: V1ProcessIR): StatementIR[] {
  return ir.procedures.flatMap((p) => flatten(p.statements));
}

/** Distinct book keys used by an IR. */
function booksOf(ir: V1ProcessIR): string[] {
  return [
    ...new Set(
      allStatements(ir)
        .filter((s) => s.kind === 'book_usage')
        .map((s) => s.bookName),
    ),
  ];
}

/** Count of subprocess-call statements in an IR. */
function subprocessCountOf(ir: V1ProcessIR): number {
  return allStatements(ir).filter((s) => s.kind === 'subprocess_call').length;
}

/** All flags (file + procedure scope) sorted by severity, then line. */
function flagsOf(ir: V1ProcessIR): Flag[] {
  const flags = [...ir.flags, ...ir.procedures.flatMap((p) => p.flags)];
  return flags.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

function roleOf(
  id: string,
  result: MigrationResult,
): ProcessRole {
  const { roots, leaves } = result.bundle.callGraph;
  if (roots.includes(id)) return 'root';
  if (leaves.includes(id)) return 'leaf';
  return 'intermediate';
}

/** Build the ordered list of {@link ProcessView}s for a migration result. */
export function buildProcessViews(result: MigrationResult): ProcessView[] {
  const failedIds = new Set<string>([
    ...result.analysis.errors.map((e) => e.procedureId),
    ...result.sop.errors.map((e) => e.procedureId),
  ]);

  return result.bundle.processes.map((proc) => {
    const ir = result.analysis.irsById[proc.id];
    const sop = result.sop.sopsById[proc.id];
    return {
      id: proc.id,
      name: proc.name,
      owner: proc.owner,
      stage: proc.stage,
      lineCount: proc.lineCount,
      source: proc.text,
      books: ir ? booksOf(ir) : [],
      subprocessCount: ir
        ? subprocessCountOf(ir)
        : proc.subprocessRefs.length,
      flags: ir ? flagsOf(ir) : [],
      role: roleOf(proc.id, result),
      ir,
      sop,
      failed: failedIds.has(proc.id),
    };
  });
}

/** Tailwind border class for a flag count (0 green, 1\u20132 yellow, 3+ orange). */
export function flagBorderClass(flagCount: number): string {
  if (flagCount === 0) return 'border-green-300';
  if (flagCount <= 2) return 'border-yellow-300';
  return 'border-orange-300';
}

/**
 * How many distinct processes reference each aggregated connection (by the
 * integration name appearing in that process's own connection requirements).
 */
export function connectionUsageCounts(
  result: MigrationResult,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sop of Object.values(result.sop.sopsById)) {
    const seen = new Set<string>();
    for (const req of sop.connectionRequirements) {
      const key = req.integration.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Re-export for convenience in components. */
export type { ConnectionRequirement };
