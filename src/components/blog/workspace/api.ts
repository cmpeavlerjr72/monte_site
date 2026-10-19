// Talking to the bot through the site: queued edits/actions, their results, photo uploads (WORKSPACE.md §2).

import { useCallback, useEffect, useRef, useState } from "react";

export type JobStatus = "working" | "saved" | "done" | "queued" | "refused" | "failed";
export type Job = {
  id: string; kind: "edit" | "action"; label: string; status: JobStatus;
  version?: number | null; error?: string | null; message?: string | null; since: number;
};

const POLL_MS = 2000;          // waiting for the bot to pick a request up (seconds)
const QUEUED_POLL_MS = 5000;   // a long job is running (minutes): check its one result file now and then
const MAX_UPLOAD = 14 * 1024 * 1024;
const SENDABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

const api = (token: string) => `/api/preview/${encodeURIComponent(token)}`;

/** A photo the server will take: phones can hand over 20 MB+ originals or odd types, so those are re-encoded to a JPEG
 *  (long side 2560 px) first. */
async function sendable(file: File): Promise<Blob> {
  if (SENDABLE.has(file.type) && file.size <= MAX_UPLOAD) return file;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
  if (!out) throw new Error("Couldn't read that photo. Try another one.");
  return out;
}

export async function uploadPhoto(token: string, secret: string, file: File): Promise<string> {
  let blob: Blob;
  try {
    blob = await sendable(file);
  } catch {
    throw new Error("Couldn't read that photo. Try a JPEG or PNG.");
  }
  const r = await fetch(`${api(token)}/uploads`, {
    method: "POST", cache: "no-store", body: blob,
    headers: { "Content-Type": blob.type || "image/jpeg", "X-Preview-Edit": secret },
  }).catch(() => null);
  if (!r) throw new Error("No connection. Try the upload again.");
  const j = await r.json().catch(() => ({}));
  if (r.status !== 201 || !j.upload) throw new Error(j.message || (r.status === 413 ? "That photo is too big." : "Upload failed. Try again."));
  return String(j.upload);
}

/** The queue of things sent to the bot and what came back. `onSettled` runs when any job gets an answer. */
export function useJobs(token: string, secret: string, onSettled: () => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  // working = the bot hasn't answered yet; queued = it answered "started a job" and will post a final answer when the job
  // ends. Only these jobs are watched (one small result file each); the page itself never refreshes on a timer
  // (owner 2026-10-19: "it could just wait and watch for the button click").
  const working = jobs.some((j) => j.status === "working");
  const open = jobs.some((j) => j.status === "working" || j.status === "queued");

  useEffect(() => {
    if (!open || !secret) return;
    const t = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const watch = jobs.filter((j) => j.status === "working" || j.status === "queued");
      const got = await Promise.all(watch.map((j) =>
        fetch(`${api(token)}/edits/${j.id}`, { cache: "no-store", headers: { "X-Preview-Edit": secret } })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      const moved = got.filter((g) => g && g.status && g.status !== "working" &&
        g.status !== watch.find((j) => j.id === g.id)?.status);
      if (!moved.length) {
        if (working) setJobs((cur) => [...cur]);    // re-render: the "is the PC on?" note depends on elapsed time
        return;
      }
      setJobs((cur) => cur.map((j) => {
        const g = moved.find((d) => d.id === j.id);
        return g ? { ...j, status: g.status, version: g.version, error: g.error, message: g.message } : j;
      }));
      settled.current();                            // one reload per change: started (shows the busy bar), then finished
    }, working ? POLL_MS : QUEUED_POLL_MS);
    return () => window.clearInterval(t);
  }, [open, working, jobs, secret, token]);

  // Good news fades on its own; problems stay until dismissed.
  useEffect(() => {
    if (open || !jobs.length || jobs.some((j) => j.status === "refused" || j.status === "failed")) return;
    const t = window.setTimeout(() => setJobs([]), 6000);
    return () => window.clearTimeout(t);
  }, [open, jobs]);

  const add = useCallback((j: Omit<Job, "status" | "since">) => {
    setJobs((cur) => [...cur.filter((x) => ["working", "queued", "refused", "failed"].includes(x.status)),
      { ...j, status: "working", since: Date.now() }]);
  }, []);
  const dismiss = useCallback(() => setJobs((cur) => cur.filter((j) => j.status === "working" || j.status === "queued")), []);
  return { jobs, add, dismiss, working };
}

/** POST one action. -> {ok, id} or {ok: false, message} (the 4xx/5xx answer, ready to show). */
export async function postAction(token: string, secret: string, type: string, args: Record<string, unknown>, base: number | null) {
  const r = await fetch(`${api(token)}/actions`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Preview-Edit": secret },
    body: JSON.stringify({ type, args, base_version: base }),
  }).catch(() => null);
  if (!r) return { ok: false as const, status: 0, message: "No connection. Try again." };
  const j = await r.json().catch(() => ({}));
  if (r.status !== 202 || !j.id) return { ok: false as const, status: r.status, message: String(j.message || "Couldn't send that. Try again.") };
  return { ok: true as const, id: String(j.id) };
}
