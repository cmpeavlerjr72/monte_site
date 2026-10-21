// src/lib/deskAccess.ts: is the signed-in account a writer / editor on the writers' desk? (owner 2026-10-21)
// The header's account menu and /desk both read this. It asks GET /api/desk/me ONCE per signed-in user and shares the
// answer. UI only: every /api/desk route checks the role again on the server.

import { useEffect, useState } from "react";
import { getAccessToken, useSession } from "./supabase";

export type DeskAccess = { writer: boolean; editor: boolean; byline: string | null; x: string | null; known: boolean };
const NONE: DeskAccess = { writer: false, editor: false, byline: null, x: null, known: false };
const memo = new Map<string, Promise<DeskAccess>>();

function accessFor(uid: string): Promise<DeskAccess> {
  const hit = memo.get(uid);
  if (hit) return hit;
  const p = (async () => {
    try {
      const jwt = await getAccessToken();
      const r = await fetch("/api/desk/me", { headers: { authorization: `Bearer ${jwt}` }, cache: "no-store" });
      if (!r.ok) return { ...NONE, known: true };
      const b = await r.json();
      return { writer: Boolean(b?.writer), editor: Boolean(b?.editor), byline: b?.byline ?? null, x: b?.x ?? null, known: true };
    } catch {
      return { ...NONE, known: true };
    }
  })();
  p.then((a) => { if (!a.writer) setTimeout(() => memo.delete(uid), 5 * 60_000); });   // a new role shows up within 5 min
  memo.set(uid, p);
  return p;
}

export function useDeskAccess(): DeskAccess {
  const { session } = useSession();
  const uid = session?.user?.id ?? "";
  const [access, setAccess] = useState<DeskAccess>(NONE);
  useEffect(() => {
    if (!uid) { setAccess(NONE); return; }
    let alive = true;
    accessFor(uid).then((a) => { if (alive) setAccess(a); });
    return () => { alive = false; };
  }, [uid]);
  return access;
}

/** An authorised call to a desk route. -> the parsed JSON (throws with the server's message on an error). */
export async function deskFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const jwt = await getAccessToken();
  const r = await fetch(path, { ...init, cache: "no-store", headers: { ...(init?.headers || {}), authorization: `Bearer ${jwt}` } });
  let j: any = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(j?.message || `Something went wrong (HTTP ${r.status}).`);
  return j as T;
}
