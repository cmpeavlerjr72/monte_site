// src/lib/mbbLive.ts
//
// Basketball live state off an ESPN MBB scoreboard event: period (1, 2 =
// halves; 3+ = overtimes), seconds left IN the period, halftime / end-of-
// period handling, possession when present, final. No down / distance.
//
// The ESPN MBB halftime encoding is UNVERIFIED (design B0 capture pending),
// so halftime is detected defensively from the status name, the detail text,
// and a "second half, full clock" pattern, and normalised to period 1, clock
// 0 (= 1200 s elapsed). Every normalisation is recorded in `flags`.

export type MbbLive = {
  state: "pre" | "in" | "final";
  /** 1, 2 = halves, 3+ = OT. Halftime is normalised to 1. */
  period?: number;
  /** Seconds left in `period`. Halftime is normalised to 0. */
  clockSec?: number;
  halftime: boolean;
  ot: boolean;
  /** ESPN team id with the ball, when `situation.possession` is present. Display only. */
  possessionId?: string;
  /** Non-fatal oddities seen while parsing (unknown encodings, missing clock). */
  flags: string[];
};

const MBB_HALF_S = 1200;

const finite = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function parseMbbStatus(e: any): MbbLive {
  const flags: string[] = [];
  const comp = e?.competitions?.[0];
  const st = comp?.status ?? e?.status ?? {};
  const type = st?.type ?? e?.status?.type ?? comp?.status?.type ?? {};
  const name = String(type.name || "").toUpperCase();
  const detail = `${type.shortDetail ?? ""} ${type.detail ?? ""} ${type.description ?? ""}`.toLowerCase();

  let state: MbbLive["state"] = "pre";
  const raw = String(type.state || "").toLowerCase();
  if (type.completed || name.includes("FINAL") || raw === "post") state = "final";
  else if (raw === "in") state = "in";

  let period = finite(st.period);
  let clockSec = finite(st.clock);
  let halftime = false;

  if (state === "in") {
    if (name.includes("HALFTIME") || /\bhalftime\b/.test(detail)) {
      halftime = true;
      flags.push(period === 2 && clockSec === 0 ? "halftime_p2_clock0" : "halftime_name");
    } else if (period === 2 && clockSec !== undefined && clockSec >= MBB_HALF_S) {
      // Second half with a full clock and no halftime status: the break
      // itself under an encoding we have not seen.
      halftime = true;
      flags.push("halftime_p2_full_clock");
    }
    if (halftime) { period = 1; clockSec = 0; }
    else if (period === undefined || clockSec === undefined) flags.push("no_period_or_clock");
    else if (clockSec < 0) { clockSec = 0; flags.push("negative_clock"); }
  }

  const poss = comp?.situation?.possession;
  const possessionId = poss !== undefined && poss !== null && poss !== "" ? String(poss) : undefined;

  return {
    state, period, clockSec, halftime,
    ot: period !== undefined && period >= 3 && !halftime,
    possessionId, flags,
  };
}
