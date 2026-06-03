'use client';

/**
 * Parent-child hierarchy tree for one process group.
 *
 * Renders a {@link HierarchyNode} forest as an indented, connector-lined tree.
 * Each node shows a role dot (root = blue, intermediate = purple, leaf = gray)
 * and the call type by which its parent invokes it. Clicking a node opens that
 * process's detail drawer (via `onSelect`), when a matching {@link ProcessView}
 * exists.
 */

import { CornerDownRight } from 'lucide-react';

import type { HierarchyNode, ProcessRole, ProcessView } from '@/lib/bundle-view';

/** Props for {@link HierarchyTree}. */
export interface HierarchyTreeProps {
  forest: HierarchyNode[];
  processesById: Map<string, ProcessView>;
  onSelect: (process: ProcessView) => void;
}

const ROLE_DOT: Record<ProcessRole, string> = {
  root: 'bg-blue-500',
  leaf: 'bg-neutral-400',
  intermediate: 'bg-purple-500',
};

export function HierarchyTree({
  forest,
  processesById,
  onSelect,
}: HierarchyTreeProps): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {forest.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          processesById={processesById}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  depth,
  processesById,
  onSelect,
}: {
  node: HierarchyNode;
  depth: number;
  processesById: Map<string, ProcessView>;
  onSelect: (process: ProcessView) => void;
}): React.JSX.Element {
  const view = processesById.get(node.id);
  const role = (view?.role ?? node.role) as ProcessRole;

  return (
    <li>
      <button
        type="button"
        disabled={!view}
        onClick={() => view && onSelect(view)}
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
        className={[
          'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition',
          view ? 'hover:bg-neutral-100' : 'cursor-default opacity-70',
        ].join(' ')}
      >
        {depth > 0 && (
          <CornerDownRight className="h-3.5 w-3.5 flex-shrink-0 text-neutral-300" />
        )}
        <span className={['h-2 w-2 flex-shrink-0 rounded-full', ROLE_DOT[role]].join(' ')} />
        <span className="truncate font-medium text-neutral-800">{node.name}</span>
        {node.callTypeFromParent && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            {node.callTypeFromParent}
          </span>
        )}
      </button>
      {node.children.length > 0 && (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <TreeNode
              key={`${node.id}->${child.id}`}
              node={child}
              depth={depth + 1}
              processesById={processesById}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
