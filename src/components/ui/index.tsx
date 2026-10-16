// src/components/ui: the site's primitives (docs/DESIGN.md).
//
// One visual dialect, based on the Record / V2 board look: 1px rules, small
// corners, the condensed display face for headlines and numbers, tabular
// figures for every stat, gold for "ours / active / starred", green and red
// for money only. Styles live in src/styles/ui.css and use theme tokens only.
//
// Keep these dumb: no data fetching, no app state. Pages compose them.

import { type ReactNode, type CSSProperties, useId } from "react";
import { NavLink } from "react-router-dom";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ------------------------------------------------------------ PageHeader -- */
/** The top of every page: optional gold kicker, display headline, one-line
 *  dek, optional actions on the right, a 1px rule under it all. */
export function PageHeader({ kicker, title, sub, actions, children, className }: {
  kicker?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode;
  children?: ReactNode; className?: string;
}) {
  return (
    <header className={cx("ph", className)}>
      <div className="ph__words">
        {kicker && <div className="kicker">{kicker}</div>}
        <h1 className="ph__title">{title}</h1>
        {sub && <p className="ph__sub">{sub}</p>}
        {children}
      </div>
      {actions && <div className="ph__actions">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ Card -- */
/** A ruled panel. `title` renders a small display-face head row; `action` sits
 *  at its right (a "See all" link, a toggle). `flush` drops the padding for
 *  tables that run edge to edge. */
export function Card({ title, kicker, action, flush, as = "section", className, style, children, id }: {
  title?: ReactNode; kicker?: ReactNode; action?: ReactNode; flush?: boolean;
  as?: "section" | "article" | "div" | "aside"; className?: string; style?: CSSProperties;
  children?: ReactNode; id?: string;
}) {
  const Tag = as;
  return (
    <Tag className={cx("ui-card", flush && "ui-card--flush", className)} style={style} id={id}>
      {(title || kicker || action) && (
        <div className="ui-card__head">
          <div className="ui-card__titles">
            {kicker && <div className="kicker">{kicker}</div>}
            {title && <h2 className="ui-card__title">{title}</h2>}
          </div>
          {action && <div className="ui-card__action">{action}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ Stat -- */
export type Tone = "pos" | "neg" | "gold" | "muted" | undefined;
/** A labelled number. `tone` colours the VALUE only (pos/neg = money). */
export function Stat({ label, value, note, tone, size = "md", className }: {
  label: ReactNode; value: ReactNode; note?: ReactNode; tone?: Tone;
  size?: "sm" | "md" | "lg" | "xl"; className?: string;
}) {
  return (
    <div className={cx("stat", `stat--${size}`, className)}>
      <div className="stat__label">{label}</div>
      <div className={cx("stat__value", tone && `tone-${tone}`)}>{value}</div>
      {note && <div className="stat__note">{note}</div>}
    </div>
  );
}
/** "+1.23" / "−0.40" with a real minus sign, and the matching tone. */
export function signedTone(n: number | null | undefined): Tone {
  if (n == null || !Number.isFinite(n) || n === 0) return undefined;
  return n > 0 ? "pos" : "neg";
}

/* ------------------------------------------------------------------ Pill -- */
/** A small square-cornered tag. Use sparingly: one per row at most. */
export function Pill({ tone = "neutral", children, title, className }: {
  tone?: "neutral" | "gold" | "navy" | "pos" | "neg" | "outline";
  children: ReactNode; title?: string; className?: string;
}) {
  return <span className={cx("pill", `pill--${tone}`, className)} title={title}>{children}</span>;
}

/* ------------------------------------------------------------------ Tabs -- */
export type TabItem = { id: string; label: ReactNode; to?: string; end?: boolean };
/** Text tabs with a gold underline. Pass `to` on each item for route tabs
 *  (NavLinks, so the URL is the state), or value/onChange for local state
 *  (real role="tablist" buttons with arrow-key support). */
export function Tabs({ items, value, onChange, label, className }: {
  items: TabItem[]; value?: string; onChange?: (id: string) => void;
  label: string; className?: string;
}) {
  const routed = items.every((i) => i.to);
  if (routed) {
    return (
      <nav className={cx("tabs", className)} aria-label={label}>
        {items.map((i) => (
          <NavLink key={i.id} to={i.to!} end={i.end} className={({ isActive }) => cx("tabs__tab", isActive && "is-active")}>
            {i.label}
          </NavLink>
        ))}
      </nav>
    );
  }
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = items[(idx + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    onChange?.(next.id);
    const el = (e.currentTarget.parentElement?.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null);
    el?.focus();
  };
  return (
    <div className={cx("tabs", className)} role="tablist" aria-label={label}>
      {items.map((i, idx) => {
        const on = i.id === value;
        return (
          <button
            key={i.id} type="button" role="tab" data-tab={i.id}
            aria-selected={on} tabIndex={on ? 0 : -1}
            className={cx("tabs__tab", on && "is-active")}
            onClick={() => onChange?.(i.id)} onKeyDown={(e) => onKey(e, idx)}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- DataTable -- */
export type Column<R> = {
  key: string; label: ReactNode; align?: "left" | "right" | "center";
  render?: (row: R, i: number) => ReactNode; width?: number | string; className?: string;
};
/** Agate-style table: uppercase small heads, 1px row rules, tabular figures,
 *  right-aligned numbers. Scrolls inside its own box on a phone, never the
 *  page. Empty rows render the `empty` node (default "—"). */
export function DataTable<R>({ columns, rows, rowKey, empty, caption, dense, className, minWidth }: {
  columns: Column<R>[]; rows: R[]; rowKey: (r: R, i: number) => string;
  empty?: ReactNode; caption?: ReactNode; dense?: boolean; className?: string; minWidth?: number;
}) {
  return (
    <div className={cx("dt-scroll", className)}>
      <table className={cx("dt", dense && "dt--dense")} style={minWidth ? { minWidth } : undefined}>
        {caption && <caption className="dt__caption">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ width: c.width, textAlign: c.align ?? "left" }} className={c.className}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="dt__empty">{empty ?? "—"}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? "left" }} className={c.className}>
                  {c.render ? c.render(r, i) : ((r as any)[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ EmptyState -- */
/** Says what is going on in words, once, with somewhere useful to go. Never a
 *  forever-skeleton, never a raw "0-0-0". */
export function EmptyState({ kicker, title, children, action, compact, className }: {
  kicker?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode;
  compact?: boolean; className?: string;
}) {
  const id = useId();
  return (
    <section className={cx("empty", compact && "empty--compact", className)} aria-labelledby={id}>
      {kicker && <div className="kicker">{kicker}</div>}
      <h2 className="empty__title" id={id}>{title}</h2>
      {children && <div className="empty__body">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </section>
  );
}

/* TeamCell lives in ./TeamCell: it needs the team-logo table (papaparse +
   a 185 KB CSV), which must not ride along with every page that uses a
   primitive. Import it from "components/ui/TeamCell". */

/* ---------------------------------------------------------------- Button -- */
/** A link or button styled as a primary (navy) or quiet (outlined) action. */
export function ButtonLink({ to, href, children, variant = "primary", className }: {
  to?: string; href?: string; children: ReactNode; variant?: "primary" | "quiet" | "gold"; className?: string;
}) {
  const cls = cx("btn-link", `btn-link--${variant}`, className);
  if (to) return <NavLink to={to} className={cls}>{children}</NavLink>;
  return <a href={href} className={cls} target={href?.startsWith("http") ? "_blank" : undefined} rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}>{children}</a>;
}
