// The draft workspace's state, as BlogBot uploads it in preview.json `ws` (contract: cfb-props-sim/scripts/blogbot/WORKSPACE.md).
// Everything is optional on read: an old bundle (or a half-built one) must never crash the page.

export type Stage = "planning" | "outline" | "writing" | "drafted" | "published" | "skipped";

export type WsImage = {
  id: string; section?: string; section_title?: string; status?: "proposed" | "approved";
  kind?: string; what?: string; why?: string; caption?: string; alt?: string; credit?: string;
  thumb?: string | null; page?: string | null; needs_embed?: boolean; in_body?: boolean; graphic?: boolean; can_hero?: boolean;
};

export type Ws = {
  v?: number;
  did?: string;
  stage?: Stage;
  busy?: { what?: string; label?: string; since?: string } | null;
  updated?: string;
  request?: string;
  reading_as?: string;
  type?: string;
  types?: { id: string; label: string }[];
  take?: string | null;
  outline?: {
    headline?: string; description?: string; lede?: string;
    sections?: { key: string; title?: string; line?: string }[];
    key_numbers?: string[]; flags?: string[]; extra?: string[];
  } | null;
  questions?: { id: string; ask: string; section?: string; status?: "waiting" | "answered" | "skipped"; answer?: string | null }[];
  sections?: { key: string; title?: string }[];
  images?: WsImage[];
  hero?: { src?: string; alt?: string; kind?: string; credit?: string | null; graphic?: boolean } | null;
  getty_browse?: { label: string; url: string }[];
  facts?: {
    summary?: string;
    bad?: { id: string; section?: string; claim: string; fix?: string }[];
    injuries?: { id: string; section?: string; claim: string; url?: string | null }[];
    notes?: string[];
  } | null;
  publish?: {
    live_url?: string | null; scheduled_at?: string | null; scheduled_label?: string | null;
    pending?: { when?: string | null; when_label?: string | null; url?: string; x_text?: string; warns?: string[] } | null;
    blocks?: string[]; no_hero_ok?: boolean;
    quick?: { label: string; when: string }[];          // schedule quick picks from the bot (Eastern time)
  } | null;
  feed?: { at?: string; text: string; level?: "info" | "warn" | "done" | "error" }[];
  can_undo?: boolean;
  guest?: { byline?: string; x?: string | null; note?: string | null; untitled?: boolean; headline?: string; summary?: string;
            ideas?: { headlines?: string[]; summary?: string; ts?: string } | null } | null;   // a guest writer's post: his words stay his
};

/** Where a new thing goes: AFTER this block (its exact Markdown as the page has it, and which copy of it). */
export type Anchor = { text: string; nth: number };

export type Act = (type: string, args?: Record<string, unknown>, label?: string) => Promise<ActResult>;
export type ActResult = { ok: boolean; status?: string; message?: string | null };
export type Upload = (file: File) => Promise<string>;
