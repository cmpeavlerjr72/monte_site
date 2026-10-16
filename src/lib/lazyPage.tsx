// src/lib/lazyPage.tsx
//
// Route-level code splitting (2026-10-16). Every page in App.tsx is a
// React.lazy() chunk, so a visitor downloads the shell plus the page they
// opened instead of one 2 MB bundle.
//
// STALE-TAB GUARD. A deploy replaces every hashed chunk name. A tab opened
// before the deploy still runs the old shell, and its next lazy import asks
// for a chunk that no longer exists: the import rejects. The fix is to reload
// ONCE, which fetches the new index.html and the new chunk names. The
// sessionStorage stamp keeps that from looping: if a reload already happened
// in this tab within RELOAD_WINDOW_MS, the error is surfaced instead (by
// RouteErrorBoundary below) rather than reloading again.

import { Component, lazy, type ComponentType, type ReactNode } from "react";

const RELOAD_KEY = "mvpeav:chunk-reload-at";
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

function reloadedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    return at > 0 && Date.now() - at < RELOAD_WINDOW_MS;
  } catch {
    // Storage blocked: never auto-reload, since the loop guard can't work.
    return true;
  }
}

export function lazyPage<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  return lazy(() =>
    load().catch((err: unknown) => {
      if (!reloadedRecently()) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
        window.location.reload();
        // Never settle: the page is going away.
        return new Promise<{ default: ComponentType<P> }>(() => {});
      }
      throw err;
    }),
  );
}

/** Catches a chunk that still fails after the one reload, so the header and
 *  footer stay up and the visitor gets a way out instead of a blank page. */
export class RouteErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error("Route failed to load", err);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: "24px 0", color: "var(--muted)" }}>
          This page didn't load.{" "}
          <a href="" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>
            Reload
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}
