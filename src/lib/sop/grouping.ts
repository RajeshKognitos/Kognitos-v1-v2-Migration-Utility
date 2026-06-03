/**
 * Process grouping for consolidated SOPs (Phase 3).
 *
 * A "process group" is a weakly-connected component of the call graph: a set of
 * processes that call each other (a parent and its transitive children). Each
 * group becomes ONE consolidated business-process SOP; a process with no call
 * relationships forms a singleton group (an individual SOP).
 *
 * All functions are pure and import only the {@link CallGraph} type, so this
 * module is safe to use on both the server (orchestrator) and the client
 * (bundle view).
 *
 * Strict TS, no `any`.
 */

import type { CallGraph } from '@/lib/har';

/** Call-graph role of a process within its group (mirrors the UI roles). */
export type GroupNodeRole = 'root' | 'leaf' | 'intermediate';

/** A connected set of processes that becomes one consolidated SOP. */
export interface ProcessGroup {
  /** Stable id for the group (derived from its members). */
  groupId: string;
  /** Every process id in the component. */
  memberIds: string[];
  /** Entry points: members with no in-group parent (usually one root). */
  entryIds: string[];
  /** Members ordered leaves-first (children before parents) for prompting. */
  orderedMemberIds: string[];
  /** True when the group is a single, disconnected process. */
  isSingleton: boolean;
}

/** A node in a group's parent-child hierarchy tree. */
export interface HierarchyNode {
  /** Process id. */
  id: string;
  /** Display name. */
  name: string;
  /** Role within the overall call graph. */
  role: GroupNodeRole;
  /** Call type by which the parent invokes this node (absent for roots). */
  callTypeFromParent?: string;
  /** Child invocations. */
  children: HierarchyNode[];
}

/** Build an undirected adjacency map over every node in the call graph. */
function undirectedAdjacency(callGraph: CallGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of callGraph.nodes) adj.set(node.id, new Set());
  for (const edge of callGraph.edges) {
    adj.get(edge.from)?.add(edge.to);
    adj.get(edge.to)?.add(edge.from);
  }
  return adj;
}

/** Directed children (parent -> child) restricted to a member set. */
function directedChildren(
  callGraph: CallGraph,
  members: Set<string>,
): Map<string, { to: string; callType: string }[]> {
  const out = new Map<string, { to: string; callType: string }[]>();
  for (const edge of callGraph.edges) {
    if (!members.has(edge.from) || !members.has(edge.to)) continue;
    const list = out.get(edge.from) ?? [];
    list.push({ to: edge.to, callType: edge.callType });
    out.set(edge.from, list);
  }
  return out;
}

/**
 * Order a component's members leaves-first (children before parents) via
 * post-order DFS from the entry points, then append any members not reached
 * (e.g. nodes only inside a cycle) in id order.
 */
function leavesFirstOrder(
  entryIds: string[],
  memberIds: string[],
  children: Map<string, { to: string; callType: string }[]>,
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const child of children.get(id) ?? []) visit(child.to);
    order.push(id);
  };
  for (const entry of entryIds) visit(entry);
  for (const id of [...memberIds].sort()) visit(id);
  return order;
}

/**
 * Partition the call graph into weakly-connected components, returning one
 * {@link ProcessGroup} per component. Groups (and their member lists) are
 * returned in a deterministic order so the pipeline output is stable.
 */
export function groupByComponent(callGraph: CallGraph): ProcessGroup[] {
  const adj = undirectedAdjacency(callGraph);
  const rootSet = new Set(callGraph.roots);
  const seen = new Set<string>();
  const groups: ProcessGroup[] = [];

  // Has any in-bundle parent? (true target of some edge) — used to find entries.
  const hasIncoming = new Set(callGraph.edges.map((e) => e.to));

  for (const node of callGraph.nodes) {
    if (seen.has(node.id)) continue;

    // BFS the undirected component.
    const memberIds: string[] = [];
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      memberIds.push(cur);
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    memberIds.sort();
    const members = new Set(memberIds);

    // Entry points: declared roots in the component, else members with no
    // in-group parent, else the first member (pure cycle fallback).
    let entryIds = memberIds.filter((id) => rootSet.has(id));
    if (entryIds.length === 0) {
      entryIds = memberIds.filter((id) => !hasIncoming.has(id));
    }
    if (entryIds.length === 0) entryIds = [memberIds[0]];

    const children = directedChildren(callGraph, members);
    const orderedMemberIds = leavesFirstOrder(entryIds, memberIds, children);

    groups.push({
      groupId: `grp:${memberIds[0]}`,
      memberIds,
      entryIds,
      orderedMemberIds,
      isSingleton: memberIds.length === 1,
    });
  }

  // Largest groups first, then by entry id for stability.
  groups.sort(
    (a, b) =>
      b.memberIds.length - a.memberIds.length ||
      a.entryIds[0].localeCompare(b.entryIds[0]),
  );
  return groups;
}

/**
 * Build the parent-child hierarchy forest for a group's members, rooted at the
 * entry points. Shared children appear under each parent that calls them; a
 * per-path visited set prevents infinite recursion on cycles.
 */
export function buildHierarchyForest(
  group: ProcessGroup,
  callGraph: CallGraph,
  nameById: Map<string, string>,
): HierarchyNode[] {
  const members = new Set(group.memberIds);
  const children = directedChildren(callGraph, members);
  const rootSet = new Set(callGraph.roots);
  const leafSet = new Set(callGraph.leaves);

  const roleOf = (id: string): GroupNodeRole => {
    if (rootSet.has(id)) return 'root';
    if (leafSet.has(id)) return 'leaf';
    return 'intermediate';
  };

  const build = (
    id: string,
    callType: string | undefined,
    path: Set<string>,
  ): HierarchyNode => {
    const node: HierarchyNode = {
      id,
      name: nameById.get(id) ?? id,
      role: roleOf(id),
      callTypeFromParent: callType,
      children: [],
    };
    if (path.has(id)) return node; // break recursive cycle
    const nextPath = new Set(path).add(id);
    for (const child of children.get(id) ?? []) {
      node.children.push(build(child.to, child.callType, nextPath));
    }
    return node;
  };

  return group.entryIds.map((entry) => build(entry, undefined, new Set()));
}

/** Render a hierarchy forest as an indented text tree (for prompts/UI text). */
export function hierarchyToText(forest: HierarchyNode[]): string {
  const lines: string[] = [];
  const walk = (node: HierarchyNode, depth: number): void => {
    const indent = '  '.repeat(depth);
    const via = node.callTypeFromParent ? ` (via ${node.callTypeFromParent})` : '';
    lines.push(`${indent}- ${node.name}${via}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of forest) walk(root, 0);
  return lines.join('\n');
}
