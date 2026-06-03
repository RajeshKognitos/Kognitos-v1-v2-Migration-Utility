'use client';

/**
 * Call-graph visualization (Phase 3.5, FILE 7).
 *
 * Renders the extractor's `CallGraph` with @xyflow/react. Nodes are colored by
 * role (root = blue, leaf = gray, intermediate = purple); edges are labeled with
 * their `callType`. Clicking a node opens that process's detail panel. Includes
 * the mini-map and zoom controls. A simple longest-path layered layout keeps the
 * graph deterministic without a layout dependency.
 */

import { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { ProcessRole, ProcessView } from '@/lib/bundle-view';
import type { CallGraph } from '@/lib/har';

/** Props for {@link CallGraphView}. */
export interface CallGraphViewProps {
  callGraph: CallGraph;
  processes: ProcessView[];
  onSelect: (process: ProcessView) => void;
}

const ROLE_COLOR: Record<ProcessRole, { bg: string; border: string }> = {
  root: { bg: '#eff6ff', border: '#2563eb' },
  leaf: { bg: '#f5f5f5', border: '#a3a3a3' },
  intermediate: { bg: '#faf5ff', border: '#9333ea' },
};

const COL_WIDTH = 280;
const ROW_HEIGHT = 96;

/** Assign each node a depth via longest path from the roots. */
function computeDepths(callGraph: CallGraph): Map<string, number> {
  const depth = new Map<string, number>();
  for (const node of callGraph.nodes) depth.set(node.id, 0);

  // Relax edges |nodes| times (handles arbitrary DAG ordering; cycles converge).
  for (let i = 0; i < callGraph.nodes.length; i += 1) {
    let changed = false;
    for (const edge of callGraph.edges) {
      const from = depth.get(edge.from) ?? 0;
      const to = depth.get(edge.to) ?? 0;
      if (to < from + 1) {
        depth.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

export function CallGraphView({
  callGraph,
  processes,
  onSelect,
}: CallGraphViewProps): React.JSX.Element {
  const byId = useMemo(
    () => new Map(processes.map((p) => [p.id, p])),
    [processes],
  );

  const { nodes, edges } = useMemo(() => {
    const depths = computeDepths(callGraph);
    const rowCursor = new Map<number, number>();

    const flowNodes: Node[] = callGraph.nodes.map((node) => {
      const view = byId.get(node.id);
      const role: ProcessRole = view?.role ?? 'intermediate';
      const depth = depths.get(node.id) ?? 0;
      const row = rowCursor.get(depth) ?? 0;
      rowCursor.set(depth, row + 1);
      const colors = ROLE_COLOR[role];

      return {
        id: node.id,
        position: { x: depth * COL_WIDTH, y: row * ROW_HEIGHT },
        data: { label: node.name },
        style: {
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 12,
          fontWeight: 500,
          color: '#171717',
          width: 220,
        },
      };
    });

    const flowEdges: Edge[] = callGraph.edges.map((edge, i) => ({
      id: `e${i}-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.callType,
      animated: true,
      labelStyle: { fontSize: 10, fill: '#737373' },
      labelBgStyle: { fill: '#ffffff' },
      style: { stroke: '#94a3b8' },
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [callGraph, byId]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const view = byId.get(node.id);
      if (view) onSelect(view);
    },
    [byId, onSelect],
  );

  const nodeColor = useCallback(
    (node: Node): string => {
      const view = byId.get(node.id);
      return ROLE_COLOR[view?.role ?? 'intermediate'].border;
    },
    [byId],
  );

  if (callGraph.nodes.length === 0) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-xl border border-neutral-200 bg-white text-sm text-neutral-400">
        No processes to graph.
      </div>
    );
  }

  return (
    <div className="relative h-[32rem] w-full overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background color="#e5e5e5" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={nodeColor} pannable zoomable />
      </ReactFlow>
      <Legend />
    </div>
  );
}

function Legend(): React.JSX.Element {
  const items: { role: ProcessRole; label: string }[] = [
    { role: 'root', label: 'Entry point' },
    { role: 'intermediate', label: 'Intermediate' },
    { role: 'leaf', label: 'Utility (leaf)' },
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex gap-3 rounded-lg border border-neutral-200 bg-white/90 px-3 py-2 text-xs text-neutral-600 shadow-sm">
      {items.map((item) => (
        <span key={item.role} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: ROLE_COLOR[item.role].border }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
