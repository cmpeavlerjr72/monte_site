// src/lib/simbookAccess.ts — is the signed-in account on the Sim Book list?
// (owner 2026-10-19: approved accounts get a "Sim Book" button.) The header and
// the account menu both read this; it asks /api/simbook/me ONCE per signed-in
// user and shares the answer, so the button costs one small request a session.

import { useEffect, useState } from "react";
import { getAccessToken, useSession } from "./supabase";

type Access = { allowed: boolean; owner: boolean };
const NONE: Access = { allowed: false, owner: false };
const memo = new Map<string, Promise<Access>>();

function accessFor(uid: string): Promise<Access> {
  const hit = memo.get(uid);
  if (hit) return hit;
  const p = (async () => {
    try {
      const jwt = await getAccessToken();
      const r = await fetch("/api/simbook/me", { headers: { authorization: `Bearer ${jwt}` }, cache: "no-store" });
      if (!r.ok) return NONE;
      const b = await r.json();
      return { allowed: Boolean(b?.allowed), owner: Boolean(b?.owner) };
    } catch {
      return NONE;
    }
  })();
  p.then((a) => { if (!a.allowed) setTimeout(() => memo.delete(uid), 5 * 60_000); });  // an invite shows up within 5 min
  memo.set(uid, p);
  return p;
}

export function useSimbookAccess(): Access {
  const { session } = useSession();
  const uid = session?.user?.id ?? "";
  const [access, setAccess] = useState<Access>(NONE);
  useEffect(() => {
    if (!uid) { setAccess(NONE); return; }
    let alive = true;
    accessFor(uid).then((a) => { if (alive) setAccess(a); });
    return () => { alive = false; };
  }, [uid]);
  return access;
}
