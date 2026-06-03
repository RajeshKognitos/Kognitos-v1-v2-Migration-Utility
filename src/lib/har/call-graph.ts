/**
 * Call-graph construction (spec Section 4.2, step 5; MR-44).
 *
 * Nodes are every extracted procedure. Edges run from a parent to each of its
 * resolvable subprocess references. Roots have no incoming edges (entry
 * points), leaves have no outgoing edges (utilities). Cycles (recursive call
 * chains) are detected via depth-first search so the agent can break them
 * before attempting a topological, leaves-first migration.
 */

import type { CallGraph, CallGraphEdge, ExtractedProcess } from './types';

/**
 * Build the call graph from the extracted processes. Only edges to targets that
 * exist in the bundle are included (missing targets are surfaced separately as
 * `MISSING_SUBPROCESS_IN_HAR` warnings, not graph edges).
 */
export function buildCallGraph(processes: ExtractedProcess[]): CallGraph {
  const nodes = processes.map((p) => ({ id: p.id, name: p.name }));
  const idSet = new Set(processes.map((p) => p.id));

  const edges: CallGraphEdge[] = [];
  const adjacency = new Map<string, Set<string>>();

  for (const proc of processes) {
    for (const ref of proc.subprocessRefs) {
      if (!idSet.has(ref.targetId)) continue;
      edges.push({ from: proc.id, to: ref.targetId, callType: ref.callType });
      let targets = adjacency.get(proc.id);
      if (!targets) {
        targets = new Set<string>();
        adjacency.set(proc.id, targets);
      }
      targets.add(ref.targetId);
    }
  }

  const hasIncoming = new Set(edges.map((e) => e.to));
  const hasOutgoing = new Set(edges.map((e) => e.from));

  const roots = nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
  const leaves = nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id);
  const cycles = detectCycles(
    nodes.map((n) => n.id),
    adjacency,
  );

  return { nodes, edges, roots, leaves, cycles };
}

type Color = 'white' | 'gray' | 'black';

/**
 * Detect cycles via DFS, recording the back-edge path for each cycle found.
 * Self-loops (`A → A`, direct recursion) yield a single-element cycle `[A]`.
 * Cycles are de-duplicated by rotation-invariant key so the same loop reached
 * from different entry points is reported once.
 */
export function detectCycles(
  ids: string[],
  adjacency: Map<string, Set<string>>,
): string[][] {
  const color = new Map<string, Color>(ids.map((id) => [id, 'white']));
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  const record = (cycle: string[]): void => {
    const key = rotationKey(cycle);
    if (!seen.has(key)) {
      seen.add(key);
      cycles.push(cycle);
    }
  };

  const visit = (u: string): void => {
    color.set(u, 'gray');
    stack.push(u);
    for (const v of adjacency.get(u) ?? []) {
      const c = color.get(v);
      if (c === 'gray') {
        // Back edge → the slice from v to u (inclusive) is a cycle.
        record(stack.slice(stack.indexOf(v)));
      } else if (c === 'white') {
        visit(v);
      }
    }
    stack.pop();
    color.set(u, 'black');
  };

  for (const id of ids) {
    if (color.get(id) === 'white') visit(id);
  }

  return cycles;
}

/** Rotation-invariant key: rotate so the smallest id is first, then join. */
function rotationKey(cycle: string[]): string {
  if (cycle.length === 0) return '';
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if (cycle[i] < cycle[minIndex]) minIndex = i;
  }
  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)].join('\u0000');
}
