// src/components/desk/Editor.tsx: the desk's word processor (owner 2026-10-28). A contentEditable with a small toolbar
// (bold, italic, section heading, bullets, quote, link, undo/redo) and an Insert menu: ask the editor for a stat /
// picture / clip / tweet, drop a link (YouTube, X, Getty or any page), or put in a photo. Inserts are cards between
// paragraphs; the writer's text around them is his, untouched. Paste from Word, Google Docs or a web page comes in clean.
// The DOM is the source of truth while typing; onChange gets the blocks (src/lib/deskDoc.ts) after every edit.

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ASK_LABEL, blocksToHtml, insertCardHtml, nodesToBlocks, pasteToHtml, type AskKind, type Block, type Insert } from "../../lib/deskDoc";

type Props = {
  initial: Block[];
  readOnly?: boolean;
  onChange: (blocks: Block[]) => void;
  uploadPhoto: (file: File) => Promise<string>;         // -> the upload name
  photoUrl: (name: string) => Promise<string | null>;   // -> an object URL for the thumbnail
  extraTools?: React.ReactNode;                         // the page's Lookup button, on the toolbar
};

export type EditorHandle = { insertParagraph: (text: string) => void };

function blockOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n && n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : null;
}

function caretBlock(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return null;
  return blockOf(root, sel.anchorNode);
}

function placeCaret(el: Node, atEnd = false) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(!atEnd);
  const sel = window.getSelection();
  sel?.removeAllRanges(); sel?.addRange(r);
}

export function Editor({ initial, readOnly, onChange, uploadPhoto, photoUrl, extraTools, handle }: Props & { handle?: (h: EditorHandle) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<{ card: HTMLElement | null; ins: Insert | null } | null>(null);
  const [fmt, setFmt] = useState({ b: false, i: false, h: false, ul: false, q: false });
  const anchorRef = useRef<HTMLElement | null>(null);

  const emit = useCallback(() => { if (root.current) onChange(nodesToBlocks(root.current)); }, [onChange]);

  const hydratePhotos = useCallback((scope: ParentNode) => {
    scope.querySelectorAll<HTMLImageElement>("img[data-photo]:not([src])").forEach((img) => {
      photoUrl(img.dataset.photo || "").then((u) => { if (u) img.src = u; });
    });
  }, [photoUrl]);

  // the initial content, once (the DOM is the source of truth afterwards; a reload from the server remounts the editor)
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.innerHTML = blocksToHtml(initial);
    hydratePhotos(el);
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* old browsers: divs are read as paragraphs */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle?.({
      insertParagraph: (text: string) => {
        const el = root.current;
        if (!el) return;
        const p = document.createElement("p");
        p.textContent = text;
        const at = caretBlock(el);
        if (at) at.after(p); else el.appendChild(p);
        placeCaret(p, true);
        emit();
      },
    });
  }, [handle, emit]);

  const refreshFmt = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const blk = caretBlock(el);
    const tag = blk?.tagName.toLowerCase() || "";
    let b = false, i = false;
    try { b = document.queryCommandState("bold"); i = document.queryCommandState("italic"); } catch { /* not supported */ }
    setFmt({ b, i, h: tag === "h2", ul: tag === "ul" || tag === "ol", q: tag === "blockquote" });
  }, []);

  const exec = (cmd: string, value?: string) => {
    root.current?.focus();
    try { document.execCommand(cmd, false, value); } catch { /* unsupported */ }
    emit(); refreshFmt();
  };
  const toggleBlock = (tag: "h2" | "blockquote") => {
    const el = root.current;
    if (!el) return;
    const blk = caretBlock(el);
    const now = blk?.tagName.toLowerCase();
    exec("formatBlock", `<${now === tag ? "p" : tag}>`);
  };
  const link = () => {
    const sel = window.getSelection();
    const has = sel && !sel.isCollapsed && root.current?.contains(sel.anchorNode);
    const url = window.prompt(has ? "Link address (https://…)" : "Link address (https://…). It'll be pasted in as the link text too.");
    if (!url) return;
    const u = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (has) exec("createLink", u);
    else exec("insertHTML", `<a href="${u.replace(/"/g, "%22")}">${u.replace(/</g, "&lt;")}</a>`);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!html && !text) return;
    e.preventDefault();
    const out = pasteToHtml(html, text);
    if (out) { try { document.execCommand("insertHTML", false, out); } catch { document.execCommand("insertText", false, text); } }
    emit();
  };

  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    // Enter at the end of a heading or a quote starts a plain paragraph, not another heading
    if (e.key === "Enter" && root.current) {
      const blk = caretBlock(root.current);
      const tag = blk?.tagName.toLowerCase();
      if (blk && (tag === "h2" || tag === "blockquote") && !(blk.textContent || "").trim()) {
        try { document.execCommand("formatBlock", false, "<p>"); } catch { /* fine */ }
      }
    }
    refreshFmt();
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>("[data-act]");
    const card = t.closest<HTMLElement>(".dw-ins");
    if (!card || !root.current?.contains(card)) { refreshFmt(); return; }
    e.preventDefault();
    if (readOnly) return;
    if (btn?.dataset.act === "remove") { card.remove(); emit(); return; }
    let ins: Insert | null = null;
    try { ins = JSON.parse(card.getAttribute("data-ins") || "") as Insert; } catch { /* fine */ }
    setSheet({ card, ins });
  };

  const openInsert = () => {
    anchorRef.current = root.current ? caretBlock(root.current) : null;
    setSheet({ card: null, ins: null });
  };

  const placeInsert = (ins: Insert) => {
    const el = root.current;
    if (!el) return;
    const t = document.createElement("template");
    t.innerHTML = insertCardHtml(ins);
    const card = t.content.firstElementChild as HTMLElement;
    if (sheet?.card) {
      sheet.card.replaceWith(card);
    } else {
      const after = anchorRef.current && el.contains(anchorRef.current) ? anchorRef.current : el.lastElementChild;
      const p = document.createElement("p"); p.innerHTML = "<br>";
      if (after) { after.after(card); card.after(p); } else { el.append(card, p); }
      placeCaret(p);
    }
    hydratePhotos(card);
    setSheet(null);
    emit();
  };

  return (
    <div className={`dw${readOnly ? " dw--ro" : ""}`}>
      {!readOnly && (
        <div className="dw-bar" role="toolbar" aria-label="Formatting">
          <button type="button" className={`dw-tb${fmt.b ? " is-on" : ""}`} title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")}><b>B</b></button>
          <button type="button" className={`dw-tb${fmt.i ? " is-on" : ""}`} title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")}><i>I</i></button>
          <button type="button" className={`dw-tb${fmt.h ? " is-on" : ""}`} title="Section heading" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleBlock("h2")}>H</button>
          <button type="button" className={`dw-tb${fmt.ul ? " is-on" : ""}`} title="Bullets" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")}>•≡</button>
          <button type="button" className={`dw-tb${fmt.q ? " is-on" : ""}`} title="Quote" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleBlock("blockquote")}>“”</button>
          <button type="button" className="dw-tb" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={link}>🔗</button>
          <span className="dw-bar__gap" />
          <button type="button" className="dw-tb" title="Undo" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("undo")}>↶</button>
          <button type="button" className="dw-tb" title="Redo" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("redo")}>↷</button>
          <span className="dw-bar__gap" />
          <button type="button" className="dw-tb dw-tb--wide" onMouseDown={(e) => e.preventDefault()} onClick={openInsert}>＋ Insert</button>
          {extraTools}
        </div>
      )}
      <div ref={root} className="dw-page" contentEditable={!readOnly} suppressContentEditableWarning spellCheck
        data-placeholder="Start typing. Put a short line like “Eagles” as a heading (H) wherever you want a section."
        onInput={emit} onPaste={onPaste} onKeyUp={onKeyUp} onClick={onClick} onFocus={refreshFmt} />
      {sheet && <InsertSheet ins={sheet.ins} editing={Boolean(sheet.card)} onClose={() => setSheet(null)} onDone={placeInsert} uploadPhoto={uploadPhoto} photoUrl={photoUrl} />}
    </div>
  );
}

const ASKS: AskKind[] = ["stat", "image", "video", "tweet", "other"];

function InsertSheet({ ins, editing, onClose, onDone, uploadPhoto, photoUrl }: {
  ins: Insert | null; editing: boolean; onClose: () => void; onDone: (ins: Insert) => void;
  uploadPhoto: (f: File) => Promise<string>; photoUrl: (name: string) => Promise<string | null>;
}) {
  const [tab, setTab] = useState<Insert["kind"]>(ins?.kind || "request");
  const [ask, setAsk] = useState<AskKind>(ins?.ask || "stat");
  const [text, setText] = useState(ins?.text || "");
  const [url, setUrl] = useState(ins?.url || "");
  const [file, setFile] = useState(ins?.file || "");
  const [own, setOwn] = useState(ins?.own !== false);
  const [credit, setCredit] = useState(ins?.credit || "");
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (file) photoUrl(file).then(setThumb); }, [file, photoUrl]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (f: File | null) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try { setFile(await uploadPhoto(f)); } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  const ready = tab === "request" ? text.trim().length >= 3 : tab === "link" ? /^(https?:\/\/)?[^\s]+\.[^\s]+$/.test(url.trim()) : Boolean(file) && (own || credit.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    const t = text.replace(/\s+/g, " ").trim();
    if (tab === "request") onDone({ kind: "request", ask, text: t });
    else if (tab === "link") onDone({ kind: "link", url: /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, text: t });
    else onDone({ kind: "photo", file, own, credit: own ? "" : credit.trim(), text: t });
  };

  return (
    <div className="dw-sheet" role="dialog" aria-modal="true" aria-label="Insert" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dw-sheet__box" onSubmit={submit}>
        <div className="dw-sheet__head">
          <strong>{editing ? "Change this" : "Insert here"}</strong>
          <button type="button" className="dw-ins__btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!editing && (
          <div className="dw-tabs" role="tablist">
            {([["request", "📌 Ask the editor"], ["link", "🔗 A link"], ["photo", "🖼 A photo"]] as [Insert["kind"], string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`dw-tab${tab === k ? " is-on" : ""}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
        )}
        {tab === "request" && (
          <>
            <p className="desk-small desk-muted">Need a number, a picture or a clip you don't have? Say what, and keep writing. The editor adds it right here.</p>
            <div className="dw-chips">
              {ASKS.map((k) => (
                <button key={k} type="button" className={`dw-chip${ask === k ? " is-on" : ""}`} onClick={() => setAsk(k)}>{ASK_LABEL[k]}</button>
              ))}
            </div>
            <label className="desk-field">
              <span>What exactly?</span>
              <textarea className="ui-sel" rows={3} value={text} maxLength={500} autoFocus onChange={(e) => setText(e.target.value)}
                placeholder={ask === "stat" ? "e.g. Dak's 4th-quarter passer rating this season" : ask === "video" ? "e.g. the Hurts fumble vs the Giants, Week 7" : "Describe it"} />
            </label>
          </>
        )}
        {tab === "link" && (
          <>
            <p className="desk-small desk-muted">A YouTube clip, an X post or a Getty photo goes straight into the piece here. Any other link is handed to the editor.</p>
            <label className="desk-field">
              <span>Address</span>
              <input className="ui-sel" type="url" inputMode="url" value={url} autoFocus onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </label>
            <label className="desk-field">
              <span>A few words <em>(optional)</em></span>
              <input className="ui-sel" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="What it is / why it goes here" />
            </label>
          </>
        )}
        {tab === "photo" && (
          <>
            <label className="desk-field">
              <span>{file ? "Swap the photo" : "Pick a photo"}</span>
              <input className="ui-sel" type="file" accept="image/jpeg,image/png,image/webp,image/heic" disabled={busy} onChange={(e) => pick(e.target.files?.[0] || null)} />
            </label>
            {busy && <p className="desk-muted desk-small">Uploading…</p>}
            {thumb && <img className="dw-sheet__thumb" src={thumb} alt="" />}
            <div className="dw-chips">
              <button type="button" className={`dw-chip${own ? " is-on" : ""}`} onClick={() => setOwn(true)}>I took it</button>
              <button type="button" className={`dw-chip${!own ? " is-on" : ""}`} onClick={() => setOwn(false)}>Someone else's</button>
            </div>
            {!own && (
              <label className="desk-field">
                <span>Whose is it? <em>(the credit goes under it)</em></span>
                <input className="ui-sel" value={credit} maxLength={200} onChange={(e) => setCredit(e.target.value)} placeholder="Photographer / site" />
              </label>
            )}
            <label className="desk-field">
              <span>What it shows <em>(optional)</em></span>
              <input className="ui-sel" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Caption" />
            </label>
          </>
        )}
        {err && <p className="desk-err">{err}</p>}
        <div className="dw-sheet__foot">
          <button type="button" className="ui-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ui-btn" data-on="true" disabled={!ready || busy}>{editing ? "Save" : "Insert"}</button>
        </div>
      </form>
    </div>
  );
}
