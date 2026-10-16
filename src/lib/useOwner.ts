// src/lib/useOwner.ts: is the signed-in viewer an OWNER? (2026-10-16)
//
// UI-only. The legacy portal-password box is shown to owners (uids named in
// the server's CFB_PORTAL_OWNERS) and nobody else; a signed-in friend is
// pointed at linking their own Kalshi key instead. The server's
// GET /api/me/role answers the one boolean and grants nothing: every portfolio
// route still runs portalGate on each request.
//
// Keyed on the uid PRIMITIVE (render-loop rule 1); one fetch per uid per page
// load, shared by every caller.

import { useEffect, useState } from "react";
import { getAccessToken } from "./supabase";

const cache = new Map<string, Promise<boolean>>();

function fetchOwner(uid: string): Promise<boolean> {
  let p = cache.get(uid);
  if (!p) {
    p = (async () => {
      try {
        const jwt = await getAccessToken();
        if (!jwt) return false;
        const r = await fetch("/api/me/role", { headers: { authorization: `Bearer ${jwt}` }, cache: "no-store" });
        if (!r.ok) return false;
        const j = await r.json();
        return j?.owner === true;
      } catch {
        return false;
      }
    })();
    cache.set(uid, p);
  }
  return p;
}

/** True only once the server has confirmed this uid is an owner. */
export function useIsOwner(uid: string | null | undefined): boolean {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    if (!uid) { setOwner(false); return; }
    let alive = true;
    void fetchOwner(uid).then((v) => { if (alive) setOwner(v); });
    return () => { alive = false; };
  }, [uid]);
  return owner;
}
