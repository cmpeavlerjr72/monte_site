import { useEffect, useRef } from "react";

/**
 * The scoreboard search box (owner 2026-10-12: "a search bar in the
 * scoreboard page so that we can look for stuff easily").
 *
 * Controlled text input with a clear button, Escape to clear, and "/" as a
 * page-wide focus shortcut (ignored while any other field has focus, so it
 * never steals a keystroke from the parlay slip or a line input). Matching
 * lives in lib/slateSearch.ts; this is only the control.
 */
export default function SlateSearch({
  value,
  onChange,
  placeholder = "Search team, conf, city…",
  width = 180,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  width?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", width, maxWidth: "100%" }}>
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { onChange(""); (e.target as HTMLInputElement).blur(); }
        }}
        placeholder={placeholder}
        aria-label="Search games"
        autoComplete="off"
        spellCheck={false}
        className="ui-sel"
        style={{ width: "100%", cursor: "text", paddingRight: value ? 26 : 8, boxSizing: "border-box" }}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(""); ref.current?.focus(); }}
          aria-label="Clear search"
          title="Clear (Esc)"
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            border: "none", background: "transparent", color: "var(--muted)",
            fontSize: 14, lineHeight: 1, padding: "2px 4px", cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
