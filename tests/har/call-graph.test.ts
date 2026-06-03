/**
 * Synthetic call-graph + cycle-detection tests (spec Section 4.2 step 5; MR-44).
 */

import { describe, it, expect } from 'vitest';
import { buildCallGraph, detectCycles } from '@/lib/har/call-graph';
import type { ExtractedProcess, SubprocessRef } from '@/lib/har/types';

function ref(targetId: string, line: number): SubprocessRef {
  return {
    displayName: targetId,
    targetId,
    callType: 'run',
    resolvableInBundle: true,
    position: { line, col: 1 },
  };
}

/** Minimal process whose only meaningful content is its subprocess targets. */
function proc(id: string, targets: string[]): ExtractedProcess {
  return {
    id,
    name: id,
    owner: null,
    stage: 'DRAFT',
    version: '',
    departmentId: 'dept',
    language: 'english',
    text: '',
    lineCount: 0,
    schedules: [],
    latestRunData: null,
    sourceHash: '',
    subprocessRefs: targets.map((t, i) => ref(t, i + 1)),
  };
}

function adj(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, new Set(v)]));
}

describe('buildCallGraph — structure', () => {
  it('computes roots and leaves for a simple DAG', () => {
    const g = buildCallGraph([
      proc('A', ['B', 'C']),
      proc('B', ['D']),
      proc('C', []),
      proc('D', []),
    ]);
    expect(g.roots).toEqual(['A']);
    expect(g.leaves.sort()).toEqual(['C', 'D']);
    expect(g.edges).toHaveLength(3);
    expect(g.cycles).toEqual([]);
  });

  it('treats an unconnected process as both a root and a leaf', () => {
    const g = buildCallGraph([proc('A', ['B']), proc('B', []), proc('Z', [])]);
    expect(g.roots.sort()).toEqual(['A', 'Z']);
    expect(g.leaves.sort()).toEqual(['B', 'Z']);
  });

  it('ignores edges to targets not present in the bundle', () => {
    const g = buildCallGraph([proc('A', ['MISSING'])]);
    expect(g.edges).toHaveLength(0);
    expect(g.roots).toEqual(['A']);
    expect(g.leaves).toEqual(['A']);
  });

  it('preserves call type on edges', () => {
    const a = proc('A', []);
    a.subprocessRefs = [
      { ...ref('B', 1), callType: 'invoke' },
      { ...ref('C', 2), callType: 'start_a_run' },
    ];
    const g = buildCallGraph([a, proc('B', []), proc('C', [])]);
    const byTarget = Object.fromEntries(g.edges.map((e) => [e.to, e.callType]));
    expect(byTarget.B).toBe('invoke');
    expect(byTarget.C).toBe('start_a_run');
  });
});

describe('buildCallGraph — cycle detection', () => {
  it('detects direct self-recursion (A → A)', () => {
    const g = buildCallGraph([proc('A', ['A'])]);
    expect(g.cycles).toHaveLength(1);
    expect(g.cycles[0]).toEqual(['A']);
    // A node in a self-loop is neither a root nor a leaf.
    expect(g.roots).toEqual([]);
    expect(g.leaves).toEqual([]);
  });

  it('detects a two-node cycle (A → B → A)', () => {
    const g = buildCallGraph([proc('A', ['B']), proc('B', ['A'])]);
    expect(g.cycles).toHaveLength(1);
    expect(new Set(g.cycles[0])).toEqual(new Set(['A', 'B']));
    expect(g.roots).toEqual([]);
    expect(g.leaves).toEqual([]);
  });

  it('detects a three-node cycle (A → B → C → A)', () => {
    const g = buildCallGraph([
      proc('A', ['B']),
      proc('B', ['C']),
      proc('C', ['A']),
    ]);
    expect(g.cycles).toHaveLength(1);
    expect(new Set(g.cycles[0])).toEqual(new Set(['A', 'B', 'C']));
  });

  it('finds a cycle even when there is also an acyclic tail', () => {
    // root → A → B → A (cycle), plus B → leaf
    const g = buildCallGraph([
      proc('root', ['A']),
      proc('A', ['B']),
      proc('B', ['A', 'leaf']),
      proc('leaf', []),
    ]);
    expect(g.cycles).toHaveLength(1);
    expect(new Set(g.cycles[0])).toEqual(new Set(['A', 'B']));
    expect(g.roots).toEqual(['root']);
    expect(g.leaves).toEqual(['leaf']);
  });
});

describe('detectCycles — direct unit cases', () => {
  it('returns nothing for a DAG', () => {
    expect(
      detectCycles(['A', 'B', 'C'], adj({ A: ['B', 'C'], B: ['C'] })),
    ).toEqual([]);
  });

  it('de-duplicates the same cycle reached from multiple entry points', () => {
    // Both X and Y lead into the same A↔B loop; it must be reported once.
    const cycles = detectCycles(
      ['X', 'Y', 'A', 'B'],
      adj({ X: ['A'], Y: ['A'], A: ['B'], B: ['A'] }),
    );
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['A', 'B']));
  });

  it('reports two independent cycles separately', () => {
    const cycles = detectCycles(
      ['A', 'B', 'C', 'D'],
      adj({ A: ['B'], B: ['A'], C: ['D'], D: ['C'] }),
    );
    expect(cycles).toHaveLength(2);
  });
});
