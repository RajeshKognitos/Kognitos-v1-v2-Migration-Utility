'use client';

/**
 * Call-graph visualization (Phase 3.5; group-scoped revamp).
 *
 * Renders the extractor's `CallGraph` with @xyflow/react, embedded per business
 * process (a sub-tab of each group card). Behavior:
 *  - Scoped to one group via `scopeGroupId`: only that process's subtree is shown,
 *    nodes are colored by call-graph role (root / intermediate / leaf), and the
 *    group filter chips are hidden. Without a scope it falls back to the global,
 *    group-tinted view with a filter chip row.
 *  - Edges are styled by call type — `invoke` (blue), `run` (slate), and
 *    `start_parallel` (dashed red, an MR-19 risk) — with a legend.
 *  - Nodes with migration flags get a risk ring (red = error, amber = warning).
 *  - Hovering a node shows a tooltip (role, books, flags, sub-calls); clicking a
 *    node opens its detail drawer AND highlights its downstream subtree (click
 *    the empty canvas to clear).
 */

import { useCallback, useMemo, useState } from 'react';
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

import type { GroupView, ProcessRole, ProcessView } from '@/lib/bundle-view';
import type { CallGraph } from '@/lib/har';
import type { Flag } from '@/types/ir';

/** Props for {@link CallGraphView}. */
export interface CallGraphViewProps {
  callGraph: CallGraph;
  processes: ProcessView[];
  /** Business-process groups (for tinting + the filter in the global view). */
  groups: GroupView[];
  onSelect: (process: ProcessView) => void;
  /**
   * When set, scope the graph to a single business process: only that group's
   * nodes are shown, nodes are colored by role, and the filter chips are hidden.
   */
  scopeGroupId?: string;
}

/** A distinct, repeatable color per business process. */
const GROUP_PALETTE = [
  { dot: '#2563eb', border: '#2563eb', bg: '#eff6ff' },
  { dot: '#9333ea', border: '#9333ea', bg: '#faf5ff' },
  { dot: '#059669', border: '#059669', bg: '#ecfdf5' },
  { dot: '#d97706', border: '#d97706', bg: '#fffbeb' },
  { dot: '#db2777', border: '#db2777', bg: '#fdf2f8' },
  { dot: '#0891b2', border: '#0891b2', bg: '#ecfeff' },
  { dot: '#65a30d', border: '#65a30d', bg: '#f7fee7' },
  { dot: '#e11d48', border: '#e11d48', bg: '#fff1f2' },
] as const;

const NEUTRAL = { dot: '#a3a3a3', border: '#a3a3a3', bg: '#fafafa' } as const;

/** Color per call-graph role (used when the graph is scoped to one group). */
const ROLE_COLORS: Record<ProcessRole, { dot: string; border: string; bg: string }> = {
  root: { dot: '#2563eb', border: '#2563eb', bg: '#eff6ff' },
  intermediate: { dot: '#9333ea', border: '#9333ea', bg: '#faf5ff' },
  leaf: { dot: '#737373', border: '#a3a3a3', bg: '#fafafa' },
};

/** Risk-ring color from the most severe flag on a node (null when clean). */
function riskRing(flags: Flag[]): string | null {
  if (flags.some((f) => f.severity === 'error')) return '#dc2626';
  if (flags.some((f) => f.severity === 'warning')) return '#d97706';
  return null;
}

/** Visual treatment per call-type edge. */
function edgeStyle(callType: string): {
  stroke: string;
  dashed: boolean;
  animated: boolean;
} {
  const t = callType.toLowerCase();
  if (t.includes('parallel')) return { stroke: '#dc2626', dashed: true, animated: true };
  if (t.includes('invoke')) return { stroke: '#2563eb', dashed: false, animated: false };
  return { stroke: '#64748b', dashed: false, animated: false };
}

const COL_WIDTH = 280;
const ROW_HEIGHT = 96;

/** Assign each node a depth via longest path from the roots (over a subgraph). */
function computeDepths(nodeIds: string[], edges: CallGraph['edges']): Map<string, number> {
  const depth = new Map<string, number>();
  for (const id of nodeIds) depth.set(id, 0);
  for (let i = 0; i < nodeIds.length; i += 1) {
    let changed = false;
    for (const edge of edges) {
      if (!depth.has(edge.from) || !depth.has(edge.to)) continue;
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
  groups,
  onSelect,
  scopeGroupId,
}: CallGraphViewProps): React.JSX.Element {
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  const scoped = scopeGroupId !== undefined;
  const byId = useMemo(() => new Map(processes.map((p) => [p.id, p])), [processes]);

  // Stable color index per group (matches the order in the Business Processes tab).
  const colorByGroup = useMemo(() => {
    const map = new Map<string, (typeof GROUP_PALETTE)[number]>();
    groups.forEach((g, i) => map.set(g.groupId, GROUP_PALETTE[i % GROUP_PALETTE.length]));
    return map;
  }, [groups]);

  const colorOf = useCallback(
    (id: string) => {
      const view = byId.get(id);
      // Scoped to one group → color by role (group color would be monochrome).
      if (scoped && view) return ROLE_COLORS[view.role];
      const gid = view?.groupId;
      return (gid && colorByGroup.get(gid)) || NEUTRAL;
    },
    [byId, colorByGroup, scoped],
  );

  // Which node ids are visible under the current scope / group filter.
  const visibleIds = useMemo(() => {
    const filter = scopeGroupId ?? groupFilter;
    if (filter === 'all') return new Set(callGraph.nodes.map((n) => n.id));
    return new Set(processes.filter((p) => p.groupId === filter).map((p) => p.id));
  }, [scopeGroupId, groupFilter, callGraph.nodes, processes]);

  // Downstream subtree of the focused node (for highlighting).
  const focusSet = useMemo(() => {
    if (!focusedId) return null;
    const adjacency = new Map<string, string[]>();
    for (const e of callGraph.edges) {
      const list = adjacency.get(e.from) ?? [];
      list.push(e.to);
      adjacency.set(e.from, list);
    }
    const set = new Set<string>();
    const stack = [focusedId];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      if (set.has(cur)) continue;
      set.add(cur);
      for (const next of adjacency.get(cur) ?? []) stack.push(next);
    }
    return set;
  }, [focusedId, callGraph.edges]);

  const { nodes, edges } = useMemo(() => {
    const visEdges = callGraph.edges.filter(
      (e) => visibleIds.has(e.from) && visibleIds.has(e.to),
    );
    const visNodeIds = callGraph.nodes.filter((n) => visibleIds.has(n.id)).map((n) => n.id);
    const depths = computeDepths(visNodeIds, visEdges);
    const rowCursor = new Map<number, number>();

    const dim = (id: string): number => (focusSet && !focusSet.has(id) ? 0.25 : 1);

    const flowNodes: Node[] = callGraph.nodes
      .filter((n) => visibleIds.has(n.id))
      .map((node) => {
        const depth = depths.get(node.id) ?? 0;
        const row = rowCursor.get(depth) ?? 0;
        rowCursor.set(depth, row + 1);
        const c = colorOf(node.id);
        const focused = focusedId === node.id;
        const ring = riskRing(byId.get(node.id)?.flags ?? []);
        return {
          id: node.id,
          position: { x: depth * COL_WIDTH, y: row * ROW_HEIGHT },
          data: { label: node.name },
          style: {
            background: c.bg,
            border: `${focused ? 3 : 2}px solid ${c.border}`,
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 500,
            color: '#171717',
            width: 220,
            opacity: dim(node.id),
            boxShadow: focused ? `0 0 0 4px ${c.border}22` : undefined,
            outline: ring ? `2px solid ${ring}` : undefined,
            outlineOffset: ring ? 2 : undefined,
          },
        };
      });

    const flowEdges: Edge[] = visEdges.map((edge, i) => {
      const s = edgeStyle(edge.callType);
      const lit = focusSet ? focusSet.has(edge.from) && focusSet.has(edge.to) : true;
      return {
        id: `e${i}-${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        label: edge.callType,
        animated: s.animated && lit,
        labelStyle: { fontSize: 10, fill: s.stroke, opacity: lit ? 1 : 0.3 },
        labelBgStyle: { fill: '#ffffff', opacity: lit ? 0.9 : 0.3 },
        style: {
          stroke: s.stroke,
          strokeWidth: lit ? 1.5 : 1,
          strokeDasharray: s.dashed ? '6 4' : undefined,
          opacity: lit ? 1 : 0.2,
        },
      };
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [callGraph.nodes, callGraph.edges, visibleIds, colorOf, focusSet, focusedId, byId]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      setFocusedId(node.id);
      const view = byId.get(node.id);
      if (view) onSelect(view);
    },
    [byId, onSelect],
  );

  const onNodeEnter = useCallback<NodeMouseHandler>((event, node) => {
    setHover({ id: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const nodeColor = useCallback((node: Node): string => colorOf(node.id).border, [colorOf]);

  if (callGraph.nodes.length === 0) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-xl border border-neutral-200 bg-white text-sm text-neutral-400">
        No processes to graph.
      </div>
    );
  }

  const hoverView = hover ? byId.get(hover.id) : null;

  return (
    <div className="space-y-3">
      {/* Group filter (doubles as the group color legend) — only in the global view. */}
      {!scoped && groups.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <FilterChip
            label="All processes"
            active={groupFilter === 'all'}
            onClick={() => setGroupFilter('all')}
          />
          {groups.map((g) => (
            <FilterChip
              key={g.groupId}
              label={g.entryName}
              color={colorByGroup.get(g.groupId)?.dot}
              active={groupFilter === g.groupId}
              onClick={() => setGroupFilter(g.groupId)}
            />
          ))}
        </div>
      )}

      <div className="relative h-[32rem] w-full overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={onNodeEnter}
          onNodeMouseLeave={() => setHover(null)}
          onPaneClick={() => setFocusedId(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
        >
          <Background color="#e5e5e5" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap nodeColor={nodeColor} pannable zoomable />
        </ReactFlow>

        <EdgeLegend />

        {focusedId && (
          <button
            type="button"
            onClick={() => setFocusedId(null)}
            className="absolute left-4 top-4 z-10 rounded-lg border border-neutral-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-neutral-600 shadow-sm transition hover:bg-neutral-50"
          >
            Clear highlight
          </button>
        )}

        {hover && hoverView && <NodeTooltip x={hover.x} y={hover.y} view={hoverView} />}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex flex-shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition',
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900',
      ].join(' ')}
    >
      {color && (
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
      )}
      <span className="max-w-[12rem] truncate">{label}</span>
    </button>
  );
}

function EdgeLegend(): React.JSX.Element {
  const edges = [
    { color: '#2563eb', dashed: false, label: 'invoke' },
    { color: '#64748b', dashed: false, label: 'run' },
    { color: '#dc2626', dashed: true, label: 'parallel (MR-19)' },
  ];
  const rings = [
    { color: '#dc2626', label: 'has error flag' },
    { color: '#d97706', label: 'has warning flag' },
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white/90 px-3 py-2 text-xs text-neutral-600 shadow-sm">
      {edges.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <svg width="22" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="22"
              y2="3"
              stroke={item.color}
              strokeWidth="2"
              strokeDasharray={item.dashed ? '5 3' : undefined}
            />
          </svg>
          {item.label}
        </span>
      ))}
      <span className="my-0.5 border-t border-neutral-100" />
      {rings.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-sm"
            style={{ outline: `2px solid ${item.color}`, outlineOffset: 1 }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function NodeTooltip({
  x,
  y,
  view,
}: {
  x: number;
  y: number;
  view: ProcessView;
}): React.JSX.Element {
  return (
    <div
      className="pointer-events-none fixed z-50 w-64 rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-xl"
      style={{ left: x + 14, top: y + 14 }}
    >
      <p className="truncate text-sm font-semibold text-neutral-900">{view.name}</p>
      <p className="mt-0.5 text-neutral-400">
        {view.role === 'root' ? 'Entry point' : view.role === 'leaf' ? 'Utility (leaf)' : 'Intermediate'}
        {' \u00b7 '}
        {view.lineCount} lines
      </p>
      <dl className="mt-2 space-y-1">
        <TooltipRow label="Sub-calls" value={String(view.subprocessCount)} />
        <TooltipRow
          label="Flags"
          value={view.flags.length === 0 ? 'none' : String(view.flags.length)}
          warn={view.flags.length > 0}
        />
        {view.books.length > 0 && <TooltipRow label="Books" value={view.books.join(', ')} />}
      </dl>
      <p className="mt-2 text-[11px] text-neutral-400">Click to open details &amp; highlight subtree</p>
    </div>
  );
}

function TooltipRow({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-neutral-400">{label}</dt>
      <dd className={['text-right font-medium', warn ? 'text-amber-600' : 'text-neutral-700'].join(' ')}>
        {value}
      </dd>
    </div>
  );
}
