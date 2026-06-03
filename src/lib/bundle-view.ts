/**
 * View-model derivation for the bundle viewer (Phase 3.5+).
 *
 * Pure functions that flatten a {@link MigrationResult} into:
 *  - per-process `ProcessView`s (cards, call-graph nodes, detail drawer), each
 *    linked to the consolidated SOP of the group it belongs to; and
 *  - per-group `GroupView`s (the new "Business Processes" tab): the parent-child
 *    hierarchy plus the one consolidated SOP / test plan / connections.
 *
 * Grouping helpers are imported directly from `@/lib/sop/grouping` (a pure,
 * type-only-dependency module) to keep the server-only OpenAI client out of the
 * client bundle.
 *
 * Strict TS, no `any`.
 */

import type { Flag, StatementIR, V1ProcessIR } from '@/types/ir';
import type { ConnectionRequirement, GroupSopResult } from '@/types/sop';
import type { MigrationResult } from '@/lib/sse-client';
import {
  buildHierarchyForest,
  groupByComponent,
  type HierarchyNode,
  type ProcessGroup,
} from '@/lib/sop/grouping';

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
  /** Id of the process group this process belongs to. */
  groupId: string;
  /** True when this process is the entry-point of its group. */
  isGroupEntry: boolean;
  /** Analyzer IR, if analysis succeeded for this process. */
  ir?: V1ProcessIR;
  /** The consolidated SOP of the group this process belongs to, if generated. */
  group?: GroupSopResult;
  /** True if analysis failed for this process or its group's SOP failed. */
  failed: boolean;
}

/** Everything the UI needs to render one business-process (group) card. */
export interface GroupView {
  /** Stable group id. */
  groupId: string;
  /** Entry-point (business process) display name. */
  entryName: string;
  /** Consolidated (multi-process) vs individual (singleton). */
  kind: 'consolidated' | 'individual';
  /** Number of processes in the group. */
  memberCount: number;
  /** Parent-child hierarchy forest (rooted at the entry points). */
  forest: HierarchyNode[];
  /** The member process views, leaves-first. */
  members: ProcessView[];
  /** The consolidated SOP + test plan + connections, if generation succeeded. */
  sop?: GroupSopResult;
  /** True when SOP generation failed for this group. */
  failed: boolean;
  /** Failure message, when `failed`. */
  error?: string;
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

function roleOf(id: string, result: MigrationResult): ProcessRole {
  const { roots, leaves } = result.bundle.callGraph;
  if (roots.includes(id)) return 'root';
  if (leaves.includes(id)) return 'leaf';
  return 'intermediate';
}

/** Shared derivation: groups, the SOP-by-group map, and the failed-group set. */
function deriveGroups(result: MigrationResult): {
  groups: ProcessGroup[];
  groupByProc: Map<string, ProcessGroup>;
  sopByGroup: Map<string, GroupSopResult>;
  failedGroups: Set<string>;
} {
  const groups = groupByComponent(result.bundle.callGraph);
  const groupByProc = new Map<string, ProcessGroup>();
  for (const group of groups) {
    for (const id of group.memberIds) groupByProc.set(id, group);
  }
  // `groups` may be absent on results persisted before consolidated SOPs.
  const sopGroups = result.sop.groups ?? [];
  const sopByGroup = new Map(sopGroups.map((g) => [g.groupId, g]));
  const failedGroups = new Set((result.sop.errors ?? []).map((e) => e.groupId));
  return { groups, groupByProc, sopByGroup, failedGroups };
}

/** Build the ordered list of {@link ProcessView}s for a migration result. */
export function buildProcessViews(result: MigrationResult): ProcessView[] {
  const analysisFailed = new Set<string>(
    result.analysis.errors.map((e) => e.procedureId),
  );
  const { groupByProc, sopByGroup, failedGroups } = deriveGroups(result);

  return result.bundle.processes.map((proc) => {
    const ir = result.analysis.irsById[proc.id];
    const group = groupByProc.get(proc.id);
    const groupId = group?.groupId ?? `grp:${proc.id}`;
    const sop = sopByGroup.get(groupId);
    return {
      id: proc.id,
      name: proc.name,
      owner: proc.owner,
      stage: proc.stage,
      lineCount: proc.lineCount,
      source: proc.text,
      books: ir ? booksOf(ir) : [],
      subprocessCount: ir ? subprocessCountOf(ir) : proc.subprocessRefs.length,
      flags: ir ? flagsOf(ir) : [],
      role: roleOf(proc.id, result),
      groupId,
      isGroupEntry: group ? group.entryIds.includes(proc.id) : true,
      ir,
      group: sop,
      failed: analysisFailed.has(proc.id) || failedGroups.has(groupId),
    };
  });
}

/** Build the per-group {@link GroupView}s for the Business Processes tab. */
export function buildGroupViews(result: MigrationResult): GroupView[] {
  const { groups, sopByGroup, failedGroups } = deriveGroups(result);
  const nameById = new Map(
    result.bundle.callGraph.nodes.map((n) => [n.id, n.name]),
  );
  const processViews = new Map(
    buildProcessViews(result).map((p) => [p.id, p]),
  );
  const errorByGroup = new Map(
    (result.sop.errors ?? []).map((e) => [e.groupId, e.error]),
  );

  return groups.map((group) => {
    const sop = sopByGroup.get(group.groupId);
    const entryName =
      sop?.entryProcedureName ??
      nameById.get(group.entryIds[0]) ??
      group.entryIds[0];
    const members = group.orderedMemberIds
      .map((id) => processViews.get(id))
      .filter((p): p is ProcessView => p !== undefined);
    return {
      groupId: group.groupId,
      entryName,
      kind: group.isSingleton ? 'individual' : 'consolidated',
      memberCount: group.memberIds.length,
      forest: buildHierarchyForest(group, result.bundle.callGraph, nameById),
      members,
      sop,
      failed: failedGroups.has(group.groupId) || !sop,
      error: errorByGroup.get(group.groupId),
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
 * How many business processes (groups) reference each aggregated connection
 * (by the integration name appearing in that group's connection requirements).
 */
export function connectionUsageCounts(
  result: MigrationResult,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of result.sop.groups ?? []) {
    const seen = new Set<string>();
    for (const req of group.connectionRequirements) {
      const key = req.integration.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Re-export for convenience in components. */
export type { ConnectionRequirement, HierarchyNode };
