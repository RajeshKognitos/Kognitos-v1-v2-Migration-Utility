'use client';

/**
 * Application shell: persistent left navigation + main content area.
 *
 * Responsive behavior:
 *  - Desktop (md+): a fixed sidebar that toggles between expanded (240px) and an
 *    icon-only rail (64px); the choice is persisted to localStorage.
 *  - Mobile (<md): the sidebar is hidden behind a slim top bar; tapping the menu
 *    opens it as a slide-in drawer with a backdrop, closing on navigation/Escape.
 *
 * Rendered once in the root layout, wrapping every page's `children`.
 */

import { useCallback, useEffect, useState } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';

import { Sidebar } from './Sidebar';

const COLLAPSE_KEY = 'kog:sidebar-collapsed';

/** Props for {@link AppShell}. */
export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore the persisted desktop collapse preference once on mount.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 hidden border-r border-neutral-200 bg-white transition-[width] duration-200 md:flex md:flex-col',
          collapsed ? 'w-16' : 'w-60',
        ].join(' ')}
      >
        <div className="flex-1 overflow-hidden">
          <Sidebar collapsed={collapsed} />
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center justify-center gap-2 border-t border-neutral-200 py-2.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" />
              Collapse
            </>
          )}
        </button>
      </aside>

      {/* ── Mobile top bar ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">
          K
        </span>
        <span className="text-sm font-semibold text-neutral-900">Kognitos Migration</span>
      </div>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-neutral-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className={['min-w-0 transition-[padding] duration-200', collapsed ? 'md:pl-16' : 'md:pl-60'].join(' ')}>
        {children}
      </div>
    </div>
  );
}
