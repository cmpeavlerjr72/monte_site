// A table you build with your thumbs (owner 2026-10-21: "make sure that in the future I can add a table like this myself").
// Used by "+" -> Table (a new table, sent as the table_add action) and by tapping a table in the draft (the same grid,
// filled from the table's Markdown, saved like any tap-edit). Cells are plain text: ** for bold still works.

import { useState } from "react";

export type Grid = string[][];                         // row 0 = the header

const cell = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();

/** grid -> a Markdown table. Empty rows are dropped; every row gets the header's number of columns. */
export function gridToMd(g: Grid): string {
  const cols = Math.max(1, g[0]?.length || 0);
  const fit = (r: string[]) => Array.from({ length: cols }, (_, i) => cell(r[i] || ""));
  const head = fit(g[0] || []);
  const body = g.slice(1).map(fit).filter((r) => r.some((c) => c));
  const line = (r: string[]) => `| ${r.join(" | ")} |`;
  return [line(head), `|${Array(cols).fill("---").join("|")}|`, ...body.map(line)].join("\n");
}

/** A Markdown table -> grid, or null when the text isn't one. */
export function mdToGrid(md: string): Grid | null {
  const lines = md.trim().split("\n").map((l) => l.trim());
  if (lines.length < 2 || !lines.every((l) => l.startsWith("|") && l.endsWith("|"))) return null;
  if (!/^\|(\s*:?-{3,}:?\s*\|)+$/.test(lines[1])) return null;
  const split = (l: string) => l.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  return [split(lines[0]), ...lines.slice(2).map(split)];
}

export const isTable = (md: string) => mdToGrid(md) !== null;

export function TableEditor({ initial, button, busy, onSave, onCancel, onDelete }: {
  initial?: Grid; button: string; busy?: boolean; onSave: (md: string) => void; onCancel?: () => void; onDelete?: () => void;
}) {
  const [g, setG] = useState<Grid>(() => initial && initial.length ? initial.map((r) => [...r]) : [["", ""], ["", ""], ["", ""]]);
  const cols = g[0].length;
  const set = (r: number, c: number, v: string) => setG((cur) => cur.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const addRow = () => setG((cur) => [...cur, Array(cols).fill("")]);
  const addCol = () => setG((cur) => cur.map((r) => [...r, ""]));
  const dropRow = (r: number) => setG((cur) => (cur.length > 2 ? cur.filter((_, i) => i !== r) : cur));
  const dropCol = () => setG((cur) => (cols > 1 ? cur.map((r) => r.slice(0, -1)) : cur));
  const ready = g[0].some((c) => c.trim()) && g.slice(1).some((r) => r.some((c) => c.trim()));
  return (
    <div className="ws-table-ed">
      <div className="ws-table-ed__scroll">
        <table>
          <tbody>
            {g.map((row, r) => (
              <tr key={r} className={r === 0 ? "ws-table-ed__head" : undefined}>
                {row.map((v, c) => (
                  <td key={c}>
                    <input className="ws-input" value={v} disabled={busy} aria-label={r === 0 ? `Column ${c + 1} name` : `Row ${r}, column ${c + 1}`}
                      placeholder={r === 0 ? (c === 0 ? "Column name" : "Column") : ""} onChange={(e) => set(r, c, e.target.value)} />
                  </td>
                ))}
                <td className="ws-table-ed__x">
                  {r > 0 && g.length > 2 && <button type="button" className="pe-btn pe-btn--small" aria-label={`Remove row ${r}`} disabled={busy} onClick={() => dropRow(r)}>×</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pe-editor__bar">
        <button type="button" className="pe-btn" disabled={busy} onClick={addRow}>+ Row</button>
        <button type="button" className="pe-btn" disabled={busy || cols >= 6} onClick={addCol}>+ Column</button>
        <button type="button" className="pe-btn" disabled={busy || cols <= 1} onClick={dropCol}>− Column</button>
      </div>
      <p className="ws-small ws-muted">Top row = the column names. Empty rows are left out.</p>
      <div className="pe-editor__bar">
        <button type="button" className="pe-btn pe-btn--primary" disabled={busy || !ready} onClick={() => onSave(gridToMd(g))}>{busy ? "Saving…" : button}</button>
        {onCancel && <button type="button" className="pe-btn" disabled={busy} onClick={onCancel}>Cancel</button>}
        {onDelete && <button type="button" className="pe-btn pe-btn--danger" disabled={busy}
          onClick={() => { if (window.confirm("Delete this table?")) onDelete(); }}>Delete table</button>}
      </div>
    </div>
  );
}
