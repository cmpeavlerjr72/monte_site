// src/lib/liveProgress.ts
//
// LIVE PROGRESS on a held (or resting) per-team stat market: where the stat
// actually stands right now, against the strike the money is on.
//
// The gap this fills (owner, 2026-08-29): "we have the reception yards bets
// but we don't have any way to actually track the yards as they accumulate."
// Every other surface in the app prices a market — this one SETTLES it, live.
//
// ONE module, so every surface agrees. It does two things and nothing else:
//
//   ticker -> (family, team side, strike)    reusing the existing parsers
//   ESPN summary -> the current value        by the settlement definition
//
// ---------------------------------------------------------------------------
// 1. THE VALUE IS A PLAYER SUM, NEVER THE TEAM ROW
// ---------------------------------------------------------------------------
// Kalshi's team RECEIVING YARDS market settles as the sum of every player's
// receiving yards, which under NCAA scoring is GROSS passing yards — a sack is
// charged to RUSHING there, not deducted from passing. So the value is summed
// off `summary.boxscore.players[].statistics["receiving"].athletes[]`, one
// column per athlete, and the same rule is applied to rushing yards.
//
// Two reasons, and only the second one is about correctness of arithmetic:
//
//   a. The team totals ROW HAS GLITCHED LIVE (Maine read 236 against a true
//      199). The row is one number nobody can check; the athlete list is the
//      thing the venue settles on and it can be read back player by player,
//      which is exactly what the popover prints.
//   b. It is the settlement definition, stated in the exporter's own caveats
//      ("team receiving yards == GROSS passing yards").
//
// MEASURED 2026-08-29 on the live UNC@TCU feed and on two finished FCS games:
// ESPN's college `netPassingYards` team row EQUALS the receiving player-sum
// even where sacks were taken (UNH allowed 4 sacks: row 235, player-sum 235;
// its `rushingYards` row 62 already carries the sack losses). So on the CFB
// feed that row is not "net of sacks" at all — the NFL intuition does not
// transfer. It agrees when it is not glitching, which is precisely why (a) is
// the reason we do not read it: agreement is not the same as being checkable.
//
// ---------------------------------------------------------------------------
// 2. THE STRIKE CLEARS AT THE TICKER'S OWN NUMBER
// ---------------------------------------------------------------------------
// A ticker ending `TCU225` is Kalshi's market "TCU: 225+ receiving yards",
// whose `floor_strike` is 224.5 and whose `strike_type` is "greater" (verified
// against the pulled market snapshot, 2026-08-29 — every RECYDS strike in the
// UNC/TCU event reads N against floor N−0.5). So:
//
//     YES settles  <=>  value > N − 0.5  <=>  value >= N
//
// which is the SAME convention `rungKeyForStrike(n) = n − 0.5` already encodes
// in teamStatMarkets.ts, and the same wording Kalshi prints ("225+"). A YES at
// TCU225 is cleared at 225, not 226. Getting this off by one would call a won
// bet a loss on the last catch of the game.
//
// ---------------------------------------------------------------------------
// 3. WHAT IS MAPPED, AND WHAT DELIBERATELY IS NOT
// ---------------------------------------------------------------------------
// A family ships here only with a verified ESPN path behind it. Everything
// else resolves to null and simply shows no progress line — never a guess:
//
//     rec_yards    receiving group, `receivingYards` per athlete, summed
//     rush_yards   rushing group, `rushingYards` per athlete, summed
//     points       the scoreboard's own score for that side
//
// Receptions, rush attempts, sacks, INTs, TDs and FGs are NOT here. Some are
// readable in principle; none has been verified against a settlement, and an
// unmapped family costing a line of UI is far cheaper than a wrong number on a
// money screen.

import { cheerLabel, parseNcaafTicker } from "./kalshiPortal";
import { STAT_FOR_SERIES, seriesOfTicker } from "./teamStatMarkets";

/* ------------------------------- the stats -------------------------------- */

/** Our `team_stats.json` stat key -> how it reads off an ESPN summary. */
export type LiveStatKey = "rec_yards" | "rush_yards" | "points";

/** The stat families that have a verified ESPN path. Anything not here has no
 *  progress line — see the header. */
export const LIVE_STAT_KEYS: readonly LiveStatKey[] = ["rec_yards", "rush_yards", "points"];

/** Short words for a stat, matching the My Book strip's own vocabulary so one
 *  bet reads the same everywhere. */
const STAT_WORDS: Record<LiveStatKey, string> = {
  rec_yards: "rec yds",
  rush_yards: "rush yds",
  points: "points",
};

/** Where the number came from, in words — the popover's first line. */
const STAT_SOURCE: Record<LiveStatKey, string> = {
  rec_yards:
    "Summed from every receiver's yards in ESPN's box score — that sum is what " +
    "Kalshi settles on (gross passing yards; a sack is charged to rushing in " +
    "college, so it never comes off this number).",
  rush_yards:
    "Summed from every rusher's yards in ESPN's box score, sack losses included " +
    "— in college a sack is a rushing attempt for negative yards.",
  points: "The scoreboard itself.",
};

/** One athlete's contribution, for the derivation. */
export type StatPart = { name: string; v: number };

/** One team's live reading of one stat. */
export type StatReading = {
  value: number;
  /** Who it came from, biggest first. Empty where the source is the scoreboard. */
  parts: StatPart[];
};

/** Both sides of one game, plus when the reading was taken. */
export type LiveTeamStats = {
  /** ESPN's home side. Callers map their own A/B onto this — see `progressFor`. */
  home: Partial<Record<LiveStatKey, StatReading>>;
  away: Partial<Record<LiveStatKey, StatReading>>;
  /** "10:07 - 1st Quarter" — ESPN's own words for when this reading is from. */
  detail: string;
  /** ESPN's state: "pre" | "in" | "post". */
  state: string;
  final: boolean;
};

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Sum one column of one player group across every athlete.
 *
 * Returns null when the GROUP is absent (a feed that has not built the box
 * score yet) and 0 when the group is present with nobody in it — which is the
 * true value at kickoff, not a missing one. That distinction is what keeps a
 * pregame card from printing "0 of 225" as if it were a reading.
 */
function playerSum(teamBlock: any, group: string, key: string): StatReading | null {
  const g = (teamBlock?.statistics ?? []).find((x: any) => x?.name === group);
  if (!g) return null;
  const i = (g.keys ?? []).indexOf(key);
  if (i < 0) return null;
  let value = 0;
  const parts: StatPart[] = [];
  for (const a of g.athletes ?? []) {
    const v = num(a?.stats?.[i]);
    value += v;
    const name = a?.athlete?.displayName;
    if (typeof name === "string" && name && v !== 0) parts.push({ name, v });
  }
  parts.sort((a, b) => b.v - a.v);
  return { value, parts };
}

function readingsFor(teamBlock: any, score: number | null): LiveTeamStats["home"] {
  const out: LiveTeamStats["home"] = {};
  const rec = playerSum(teamBlock, "receiving", "receivingYards");
  if (rec) out.rec_yards = rec;
  const rush = playerSum(teamBlock, "rushing", "rushingYards");
  if (rush) out.rush_yards = rush;
  if (score !== null) out.points = { value: score, parts: [] };
  return out;
}

/**
 * Parse an ESPN game summary into both teams' live stat readings.
 *
 * The home/away split comes from the header's own `homeAway` flags joined to
 * the box score by TEAM ID — never by slot order and never by name, so a
 * neutral-site game or a re-ordered payload cannot swap the two teams'
 * numbers onto each other's bets.
 *
 * Null whenever the payload has no box score at all (pregame, or a feed that
 * only carries the header) — the caller then shows a reserved, empty line.
 */
export function parseLiveTeamStats(json: any): LiveTeamStats | null {
  const comp = json?.header?.competitions?.[0];
  const players = json?.boxscore?.players;
  if (!comp || !Array.isArray(players) || !players.length) return null;

  const sideOf = (which: string) =>
    (comp.competitors ?? []).find((c: any) => c?.homeAway === which);
  const h = sideOf("home");
  const a = sideOf("away");
  const blockFor = (teamId: any) =>
    players.find((p: any) => String(p?.team?.id ?? "") === String(teamId ?? ""));

  const scoreOf = (c: any): number | null => {
    const n = Number(c?.score);
    return Number.isFinite(n) ? n : null;
  };

  const state = String(comp?.status?.type?.state ?? "");
  return {
    home: readingsFor(blockFor(h?.team?.id), scoreOf(h)),
    away: readingsFor(blockFor(a?.team?.id), scoreOf(a)),
    detail: String(comp?.status?.type?.detail ?? comp?.status?.type?.description ?? ""),
    state,
    final: state === "post" || Boolean(comp?.status?.type?.completed),
  };
}

/* ----------------------------- ticker -> market --------------------------- */

/** What a ticker says about the bet, once we know we can track it. */
export type StatTarget = {
  statKey: LiveStatKey;
  /** Kalshi's own strike number: the market clears at value >= strike. */
  strike: number;
  /** The strike names OUR home team (teamA). Same flag `parseNcaafTicker`
   *  reports — the event code's team blob is away+home. */
  strikeIsHome: boolean;
};

/**
 * The tracked target behind a ticker, or null when nothing here can track it
 * (an unmapped family, a malformed ticker, a market with no strike).
 *
 * This is the ONE test a surface should run to decide whether a bet gets a
 * progress line — cheap, synchronous and independent of any fetch, which is
 * what lets a card reserve the line's height before the data lands.
 */
export function statTargetOf(ticker: string): StatTarget | null {
  const stat = STAT_FOR_SERIES[seriesOfTicker(ticker)];
  if (!stat || !(LIVE_STAT_KEYS as readonly string[]).includes(stat)) return null;
  const t = parseNcaafTicker(ticker);
  if (!t || t.n === null || !t.strikeTeam) return null;
  return { statKey: stat as LiveStatKey, strike: t.n, strikeIsHome: t.strikeIsHome };
}

/* -------------------------------- the verdict ----------------------------- */

export type ProgressTone = "pos" | "neg" | "flat";

export type StatProgress = {
  /** React key and the join back to the bet. */
  ticker: string;
  side: "yes" | "no";
  statKey: LiveStatKey;
  /** The bet in Kalshi's own wording ("TCU 225+ rec yds"). */
  label: string;
  /** Where the stat stands right now. */
  value: number;
  /** Where it has to get to (or stay under). Clears at value >= strike. */
  strike: number;
  /** 0..1 toward the strike, clamped — what the bar draws. */
  frac: number;
  /** THE VERDICT, in as few words as it takes: "38 to go", "CLEARED". */
  chip: string;
  tone: ProgressTone;
  /** The derivation, one fact per line — the tap popover and the a11y label. */
  lines: string[];
};

/**
 * Progress for ONE bet, or null when it cannot be tracked.
 *
 * `espnHomeIsA` is the card's own ESPN join (teamA is home on our side; ESPN
 * can disagree on a neutral site), so the mapping is structural at both hops —
 * ticker says which of OUR teams, the card says which of ESPN's — and no name
 * comparison happens anywhere in this file.
 */
export function progressFor(
  ticker: string,
  side: string,
  espnHomeIsA: boolean,
  stats: LiveTeamStats | null,
): StatProgress | null {
  const target = statTargetOf(ticker);
  if (!target || !stats) return null;

  // ticker -> our side (A = home) -> ESPN's side.
  const isEspnHome = target.strikeIsHome === espnHomeIsA;
  const reading = (isEspnHome ? stats.home : stats.away)[target.statKey];
  if (!reading) return null;

  const no = side === "no";
  const { value, parts } = reading;
  const { strike, statKey } = target;
  const words = STAT_WORDS[statKey];
  // Kalshi's floor strike is N − 0.5 and "greater", so N itself clears. See
  // the header — this is the one comparison that must not drift.
  const over = value >= strike;
  const gap = strike - value;

  let chip: string;
  let tone: ProgressTone;
  if (stats.final) {
    const won = over !== no;
    chip = won ? "HIT" : "MISSED";
    tone = won ? "pos" : "neg";
  } else if (no) {
    // "spare", not "of room": the chip is 64px and a NO's cushion is the one
    // state whose number runs to three digits, so the words have to fit beside
    // it. The popover says it in full.
    chip = over ? "BUSTED" : `${gap} spare`;
    tone = over ? "neg" : "flat";
  } else {
    chip = over ? "CLEARED" : `${gap} to go`;
    tone = over ? "pos" : "flat";
  }

  const label = cheerLabel(ticker, side);
  const lines: string[] = [];
  lines.push(
    no
      ? `${label}: ${value} ${words} so far, and it stays a winner below ${strike}.`
      : `${label}: ${value} ${words} so far, and it settles at ${strike}.`,
  );
  lines.push(
    stats.final
      ? `Final — ${chip === "HIT" ? "it got there" : "it did not"}.`
      : over
        ? no
          ? `Already past ${strike}, so this one is losing as it stands.`
          : `Already at ${strike}, so this one is winning as it stands.`
        : no
          ? `${gap} more ${words} would take it through ${strike}.`
          : `${gap} more ${words} gets it there.`,
  );
  if (parts.length) {
    const top = parts.slice(0, 3).map((p) => `${p.name} ${p.v}`).join(", ");
    lines.push(
      parts.length > 3 ? `Most of it: ${top} — ${parts.length} players in all.` : `From ${top}.`,
    );
  }
  lines.push(STAT_SOURCE[statKey]);
  if (stats.detail) lines.push(`Read at ${stats.detail}, straight from ESPN's live box score.`);

  return {
    ticker,
    side: no ? "no" : "yes",
    statKey,
    label,
    value,
    strike,
    frac: strike > 0 ? Math.max(0, Math.min(1, value / strike)) : 0,
    chip,
    tone,
    lines,
  };
}

/* ------------------------------- the surfaces ----------------------------- */

/** The minimum a surface has to hand over per bet. Both the card's book rows
 *  and the console's resting rows already carry exactly this. */
export type ProgressBet = { ticker: string; side: string };

/**
 * The trackable bets on one game, de-duplicated and ready to display.
 *
 * Synchronous and FETCH-FREE — it only reads tickers — so a card can call it to
 * decide whether to reserve the block's height BEFORE any ESPN data exists,
 * which is what keeps the strip from shifting the card when the first reading
 * lands. It is also the gate on the poll itself: no trackable bet, no fetch.
 *
 * A market can be BOTH held and resting (a partial fill is exactly that), and
 * the strip answers ONE question per market — where the stat stands — so it
 * says it once. Held-vs-resting identity stays on the book strip below, which
 * is the surface that is about the bets themselves.
 */
export function progressBetsOf(
  bets: { ticker?: string; side: string }[] | undefined,
): ProgressBet[] {
  const seen = new Set<string>();
  const out: ProgressBet[] = [];
  for (const b of bets ?? []) {
    if (!b.ticker || !statTargetOf(b.ticker)) continue;
    const k = `${b.ticker}|${b.side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ticker: b.ticker, side: b.side });
  }
  return out;
}
