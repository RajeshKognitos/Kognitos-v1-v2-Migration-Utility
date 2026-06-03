'use client';

/**
 * App navigation sidebar (shared chrome).
 *
 * Presentational nav rendered by {@link import('./AppShell').AppShell} in three
 * contexts: the persistent desktop rail (expanded or collapsed) and the mobile
 * slide-in drawer. Active state is derived from the current path. "Soon" items
 * are intentional, disabled scaffolding so the IA is visible as the tool grows.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Clock,
  FileBarChart2,
  Plug,
  Play,
  Plus,
  Settings,
  Workflow,
} from 'lucide-react';

/** A single navigation entry. */
interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Extra path prefixes that should also mark this item active. */
  activePrefixes?: string[];
  /** Disabled, "coming soon" placeholder (extensibility scaffold). */
  soon?: boolean;
}

const PRIMARY: NavItem[] = [
  { label: 'New migration', href: '/', icon: <Plus className="h-[18px] w-[18px]" /> },
  {
    label: 'History',
    href: '/history',
    icon: <Clock className="h-[18px] w-[18px]" />,
    activePrefixes: ['/history', '/migration'],
  },
  { label: 'Sample run', href: '/demo', icon: <Play className="h-[18px] w-[18px]" /> },
];

const WORKSPACE: NavItem[] = [
  { label: 'Connections', href: '#', icon: <Plug className="h-[18px] w-[18px]" />, soon: true },
  { label: 'Reports', href: '#', icon: <FileBarChart2 className="h-[18px] w-[18px]" />, soon: true },
  { label: 'Settings', href: '#', icon: <Settings className="h-[18px] w-[18px]" />, soon: true },
];

/** Props for {@link Sidebar}. */
export interface SidebarProps {
  /** Icon-only rail when true (desktop). */
  collapsed?: boolean;
  /** Called after a nav link is followed (used to close the mobile drawer). */
  onNavigate?: () => void;
}

export function Sidebar({ collapsed = false, onNavigate }: SidebarProps): React.JSX.Element {
  const pathname = usePathname();

  const isActive = (item: NavItem): boolean => {
    if (item.soon) return false;
    if (item.activePrefixes) {
      return item.activePrefixes.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
      );
    }
    return pathname === item.href;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className={['flex items-center gap-2.5 px-4 py-5', collapsed ? 'justify-center px-0' : ''].join(' ')}>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-bold text-white shadow-sm">
          K
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">Kognitos</p>
            <p className="truncate text-xs text-neutral-400">Migration Utility</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        <NavGroup
          items={PRIMARY}
          collapsed={collapsed}
          isActive={isActive}
          onNavigate={onNavigate}
        />
        <NavGroup
          title="Workspace"
          items={WORKSPACE}
          collapsed={collapsed}
          isActive={isActive}
          onNavigate={onNavigate}
        />
      </nav>

      {/* Footer */}
      <div className={['border-t border-neutral-200 px-4 py-3', collapsed ? 'px-0 text-center' : ''].join(' ')}>
        {collapsed ? (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-500">
            v1
          </span>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-neutral-400">
            <Workflow className="h-3.5 w-3.5" />
            Internal tool &middot; v1 &rarr; v2
          </p>
        )}
      </div>
    </div>
  );
}

function NavGroup({
  title,
  items,
  collapsed,
  isActive,
  onNavigate,
}: {
  title?: string;
  items: NavItem[];
  collapsed: boolean;
  isActive: (item: NavItem) => boolean;
  onNavigate?: () => void;
}): React.JSX.Element {
  return (
    <div>
      {title && !collapsed && (
        <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          {title}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.label}>
            <NavLink
              item={item}
              active={isActive(item)}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}): React.JSX.Element {
  const base = [
    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
    collapsed ? 'justify-center px-0' : '',
  ].join(' ');

  if (item.soon) {
    return (
      <span
        title={collapsed ? `${item.label} (soon)` : undefined}
        aria-disabled="true"
        className={[base, 'cursor-not-allowed text-neutral-400'].join(' ')}
      >
        <span className="flex-shrink-0 text-neutral-300">{item.icon}</span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-400">
              Soon
            </span>
          </>
        )}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={[
        base,
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
      ].join(' ')}
    >
      <span
        className={[
          'flex-shrink-0',
          active ? 'text-blue-600' : 'text-neutral-400 group-hover:text-neutral-600',
        ].join(' ')}
      >
        {item.icon}
      </span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
    </Link>
  );
}
