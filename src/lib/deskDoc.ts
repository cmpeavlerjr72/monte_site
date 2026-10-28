// src/lib/deskDoc.ts: the desk editor's document (owner 2026-10-28): blocks <-> the contentEditable's DOM, and the same
// inline clean-up the server applies (server/liveScores.ts, "THE DESK EDITOR"). A block is a paragraph, heading, bullet
// or quote with inline HTML limited to <b> <i> <a href> <br>, or an insert: something the writer put between two
// paragraphs for the editor (a request, a link, a photo). BlogBot turns the blocks into his article, every character kept.

export type AskKind = "image" | "video" | "tweet" | "stat" | "other";
export type Insert = { kind: "link" | "photo" | "request"; ask?: AskKind; url?: string; file?: string; credit?: string; own?: boolean; text?: string };
export type TextBlock = { kind: "p" | "h" | "li" | "quote"; html: string };
export type Block = TextBlock | { kind: "insert"; insert: Insert };
export type DeskDoc = {
  id: string; rev: number; title: string; sport: string; summary: string; note: string; blocks: Block[];
  created: string; updated: string; submitted: { sid: string; at: string } | null;
};

export const ASK_LABEL: Record<AskKind, string> = { image: "a picture", video: "a clip", tweet: "a tweet", stat: "a stat", other: "something else" };
export const DOC_ID_RE = /^\d{13}-[a-f0-9]{8}$/;

export function newDocId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${Date.now()}-${hex}`;
}

export function emptyDoc(id: string, sport = "nfl"): DeskDoc {
  const now = new Date().toISOString();
  return { id, rev: 0, title: "", sport, summary: "", note: "", blocks: [], created: now, updated: now, submitted: null };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function styleSays(el: Element, prop: string, re: RegExp): boolean {
  const st = (el.getAttribute("style") || "").toLowerCase();
  const m = new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(st);
  return Boolean(m && re.test(m[1].trim()));
}

/** Inline content of one block -> <b> <i> <a href="http…"> <br> and text only. Google Docs' bold-as-style spans and its
 *  "<b style=font-weight:normal>" wrapper, and Word's spans, all come out right. */
export function cleanInline(node: Node): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) { out += esc(n.textContent || ""); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") { out += "<br>"; return; }
    if (tag === "script" || tag === "style" || tag === "template") return;
    if (tag === "img" || tag === "svg" || tag === "video") return;
    const inner = cleanInline(el);
    if (!inner) return;
    let bold = (tag === "b" || tag === "strong") && !styleSays(el, "font-weight", /^(normal|400|300|lighter)$/);
    let italic = tag === "i" || tag === "em";
    if (tag === "span" || tag === "font") {
      if (styleSays(el, "font-weight", /^(bold|bolder|[6-9]00)$/)) bold = true;
      if (styleSays(el, "font-style", /^(italic|oblique)$/)) italic = true;
    }
    if (tag === "a") {
      const href = (el.getAttribute("href") || "").trim();
      if (/^https?:\/\/[^\s"'<>]{1,500}$/i.test(href)) { out += `<a href="${esc(href)}">${inner}</a>`; return; }
    }
    if (bold) out += `<b>${inner}</b>`;
    else if (italic) out += `<i>${inner}</i>`;
    else out += inner;
  });
  return out;
}

export function plainOf(html: string): string {
  const t = document.createElement("template");
  t.innerHTML = html.replace(/<br\s*\/?>/gi, "\n");
  return t.content.textContent || "";
}

export function wordCount(blocks: Block[]): number {
  return blocks.filter((b): b is TextBlock => b.kind !== "insert").map((b) => plainOf(b.html).trim()).filter(Boolean)
    .join(" ").split(/\s+/).filter(Boolean).length;
}

const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "section", "article", "table", "pre"]);

function hasBlockChildren(el: Element): boolean {
  return Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()) || c.classList.contains("dw-ins"));
}

/** The editor's DOM (or a pasted document) -> blocks. Empty text blocks are dropped. */
export function nodesToBlocks(root: Node, allowInserts = true): Block[] {
  const out: Block[] = [];
  const pushText = (kind: TextBlock["kind"], node: Node) => {
    const html = cleanInline(node);
    if (plainOf(html).trim()) out.push({ kind, html });
  };
  const walk = (node: Node) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        if ((n.textContent || "").trim()) out.push({ kind: "p", html: esc(n.textContent || "") });
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as Element;
      const tag = el.tagName.toLowerCase();
      if (el.classList.contains("dw-ins")) {
        if (!allowInserts) return;
        try { out.push({ kind: "insert", insert: JSON.parse(el.getAttribute("data-ins") || "") as Insert }); } catch { /* a broken card is dropped */ }
        return;
      }
      if (tag === "br" || tag === "script" || tag === "style" || tag === "img") return;
      if (/^h[1-6]$/.test(tag)) { pushText("h", el); return; }
      if (tag === "ul" || tag === "ol") {
        el.querySelectorAll(":scope > li").forEach((li) => {
          const copy = li.cloneNode(true) as Element;
          copy.querySelectorAll("ul, ol").forEach((sub) => sub.remove());
          pushText("li", copy);
          li.querySelectorAll(":scope > ul > li, :scope > ol > li").forEach((sub) => pushText("li", sub));
        });
        return;
      }
      if (tag === "li") { pushText("li", el); return; }
      if (tag === "blockquote") {
        if (hasBlockChildren(el)) {
          el.childNodes.forEach((c) => {
            if (c.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((c as Element).tagName.toLowerCase())) pushText("quote", c);
            else if ((c.textContent || "").trim()) pushText("quote", c);
          });
        } else pushText("quote", el);
        return;
      }
      if (BLOCK_TAGS.has(tag) || tag === "body" || tag === "html") {
        if (hasBlockChildren(el)) {
          // mixed content (text beside blocks): the loose runs become paragraphs of their own
          let run: Node[] = [];
          const flush = () => { if (run.length) { const d = document.createElement("div"); run.forEach((r) => d.appendChild(r.cloneNode(true))); pushText("p", d); run = []; } };
          el.childNodes.forEach((c) => {
            const isBlock = c.nodeType === Node.ELEMENT_NODE && (BLOCK_TAGS.has((c as Element).tagName.toLowerCase()) || (c as Element).classList.contains("dw-ins"));
            if (isBlock) { flush(); walk({ childNodes: [c] } as unknown as Node); } else run.push(c);
          });
          flush();
        } else pushText(tag === "pre" ? "p" : "p", el);
        return;
      }
      pushText("p", el);                                  // a stray inline element at the top level
    });
  };
  walk(root);
  return out;
}

export function insertSummary(ins: Insert): string {
  if (ins.kind === "request") return `Ask the editor for ${ASK_LABEL[ins.ask || "other"]}${ins.text ? `: ${ins.text}` : ""}`;
  if (ins.kind === "link") return `Link${ins.text ? ` (${ins.text})` : ""}: ${ins.url || ""}`;
  return `Photo${ins.text ? `: ${ins.text}` : ""}${ins.own === false && ins.credit ? ` (credit: ${ins.credit})` : ""}`;
}

/** One insert card for the editor's DOM (not editable itself; the page handles its buttons). */
export function insertCardHtml(ins: Insert): string {
  const icon = ins.kind === "request" ? "📌" : ins.kind === "link" ? "🔗" : "🖼";
  const thumb = ins.kind === "photo" && ins.file ? `<img class="dw-ins__thumb" alt="" data-photo="${esc(ins.file)}">` : "";
  return `<div class="dw-ins dw-ins--${ins.kind}" contenteditable="false" data-ins="${esc(JSON.stringify(ins))}">`
    + `${thumb}<span class="dw-ins__icon" aria-hidden="true">${icon}</span><span class="dw-ins__text">${esc(insertSummary(ins))}</span>`
    + `<span class="dw-ins__btns"><button type="button" class="dw-ins__btn" data-act="edit">Edit</button>`
    + `<button type="button" class="dw-ins__btn" data-act="remove" aria-label="Remove">✕</button></span></div>`;
}

/** Blocks -> the editor's innerHTML. Consecutive bullets become one list. */
export function blocksToHtml(blocks: Block[]): string {
  const parts: string[] = [];
  let list: string[] | null = null;
  const closeList = () => { if (list) { parts.push(`<ul>${list.join("")}</ul>`); list = null; } };
  for (const b of blocks) {
    if (b.kind === "li") { (list ??= []).push(`<li>${b.html || "<br>"}</li>`); continue; }
    closeList();
    if (b.kind === "insert") parts.push(insertCardHtml(b.insert));
    else if (b.kind === "h") parts.push(`<h2>${b.html || "<br>"}</h2>`);
    else if (b.kind === "quote") parts.push(`<blockquote><p>${b.html || "<br>"}</p></blockquote>`);
    else parts.push(`<p>${b.html || "<br>"}</p>`);
  }
  closeList();
  return parts.length ? parts.join("") : "<p><br></p>";
}

/** A paste (Word, Google Docs, a web page, plain text) -> clean block HTML to insert. */
export function pasteToHtml(html: string, text: string): string {
  if (html && html.trim()) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const blocks = nodesToBlocks(doc.body, false);
      if (blocks.length) return blocksToHtml(blocks);
    } catch { /* plain text below */ }
  }
  const lines = (text || "").replace(/\r\n/g, "\n").split(/\n{2,}|\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  return blocksToHtml(lines.map((l) => (/^[-•*]\s+/.test(l) ? { kind: "li", html: esc(l.replace(/^[-•*]\s+/, "")) } : { kind: "p", html: esc(l) })));
}

const localKey = (id: string) => `mvpeav:deskdoc:${id}`;
export type LocalCopy = { base_rev: number; dirty: boolean; doc: DeskDoc; at: number };

export function readLocal(id: string): LocalCopy | null {
  try {
    const raw = localStorage.getItem(localKey(id));
    const j = raw ? (JSON.parse(raw) as LocalCopy) : null;
    return j && j.doc && Array.isArray(j.doc.blocks) ? j : null;
  } catch { return null; }
}
export function writeLocal(id: string, copy: LocalCopy) {
  try { localStorage.setItem(localKey(id), JSON.stringify(copy)); } catch { /* private mode or full: the server copy is the record */ }
}
export function dropLocal(id: string) {
  try { localStorage.removeItem(localKey(id)); } catch { /* nothing stored */ }
}
