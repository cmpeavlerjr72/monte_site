// Small building blocks for the draft workspace: a bottom sheet, a note box, a photo picker.

import { useEffect, useRef, useState } from "react";

/** A phone-style bottom sheet (a centered dialog on wide screens). Escape or the backdrop closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus({ preventScroll: true });
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="ws-sheet" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws-sheet__panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="ws-sheet__head">
          <h2 className="ws-sheet__title">{title}</h2>
          <button type="button" className="ws-sheet__x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="ws-sheet__body">{children}</div>
      </div>
    </div>
  );
}

/** A textarea + send button. Clears itself after a successful send. */
export function NoteBox({ label, placeholder, button, onSend, rows = 3, initial = "", allowEmpty = false, autoFocus = false }: {
  label?: string; placeholder?: string; button: string; onSend: (text: string) => Promise<boolean> | boolean; rows?: number;
  initial?: string; allowEmpty?: boolean; autoFocus?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form className="ws-note" onSubmit={async (e) => {
      e.preventDefault();
      if ((!text.trim() && !allowEmpty) || busy) return;
      setBusy(true);
      const ok = await onSend(text.trim());
      setBusy(false);
      if (ok) setText("");
    }}>
      {label && <label className="ws-label">{label}</label>}
      <textarea value={text} rows={rows} placeholder={placeholder} onChange={(e) => setText(e.target.value)} disabled={busy}
        aria-label={label || placeholder} autoFocus={autoFocus} />
      <div className="ws-row">
        <button type="submit" className="pe-btn pe-btn--primary" disabled={busy || (!text.trim() && !allowEmpty)}>{busy ? "Sending…" : button}</button>
      </div>
    </form>
  );
}

/** A photo picker that hands back a File, with "is this your photo?" (own) and the credit when it isn't. */
export function PhotoPick({ button, onPick, askOwn = true, withAlt = true }: {
  button: string; askOwn?: boolean; withAlt?: boolean;
  onPick: (file: File, opts: { own: boolean; credit: string; alt: string }) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [own, setOwn] = useState(true);
  const [credit, setCredit] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <div className="ws-pick">
      <label className="pe-btn ws-pick__choose">
        {file ? "Choose a different photo" : "Choose a photo"}
        <input type="file" accept="image/*" onChange={(e) => {
          const f = e.target.files?.[0] || null;
          setFile(f);
          if (url) URL.revokeObjectURL(url);
          setUrl(f ? URL.createObjectURL(f) : "");
        }} />
      </label>
      {file && (
        <>
          {url && <img className="ws-pick__thumb" src={url} alt="" />}
          {askOwn && (
            <fieldset className="ws-seg">
              <legend className="ws-label">Is this your photo?</legend>
              <label><input type="radio" checked={own} onChange={() => setOwn(true)} /> Yes, mine</label>
              <label><input type="radio" checked={!own} onChange={() => setOwn(false)} /> No</label>
            </fieldset>
          )}
          {askOwn && !own && (
            <input className="ws-input" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Credit (whose photo is it?)" aria-label="Credit" />
          )}
          {withAlt && (
            <input className="ws-input" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="What does it show? (alt text, optional)" aria-label="Alt text" />
          )}
          <div className="ws-row">
            <button type="button" className="pe-btn pe-btn--primary" disabled={busy || (askOwn && !own && !credit.trim())}
              onClick={async () => {
                setBusy(true);
                const ok = await onPick(file, { own, credit: credit.trim(), alt: alt.trim() });
                setBusy(false);
                if (ok) { setFile(null); setUrl(""); setCredit(""); setAlt(""); }
              }}>
              {busy ? "Uploading…" : button}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** "3 min" since an ISO time (naive times are the PC's Eastern time; close enough for an elapsed counter). */
export function elapsed(since?: string, now = Date.now()): string {
  if (!since) return "";
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
