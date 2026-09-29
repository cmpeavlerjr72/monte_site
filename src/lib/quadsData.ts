// CFB Quads: types + pure helpers for `/cfb/quads`.
import { dataUrl } from "./cfbData";

export type QuadKey = "q1" | "q2" | "q3" | "q4" | "fcs";
export type WL = [number, number];
export type QuadRecord = Record<QuadKey, WL>;
export type VersionKey = "A" | "B" | "C" | "D";

export const QUAD_KEYS: QuadKey[] = ["q1", "q2", "q3", "q4", "fcs"];
export const VERSION_KEYS: VersionKey[] = ["A", "B", "C", "D"];

export interface QuadsVersion {
  key: VersionKey;
  name: string;
  short: string;
  blurb: string;
  rules: { label: string; text: string }[];
}
export interface QuadsGame {
  week: number;
  date: string;
  opp: string;
  opp_sp_rank: number | null;
  site: "H" | "A" | "N";
  result: "W" | "L" | null;
  score: string | null;
  bubble_wp: number | null;
  quad: Record<VersionKey, QuadKey>;
}
export interface QuadsTeam {
  team: string;
  conference: string;
  sp: number;
  sp_rank: number;
  record: string;
  wab: number;
  rank: Record<VersionKey, number>;
  score: Record<VersionKey, number>;
  quads: Record<VersionKey, QuadRecord>;
  remaining: Record<VersionKey, Record<QuadKey, number>>;
  games: QuadsGame[];
}
export interface QuadsBacktestMetric {
  version: VersionKey | "record" | "sp";
  label: string;
  pairwise: number;
  top4: number;
  top12: number;
  spearman25: number;
}
export interface QuadsFile {
  season: number;
  through_week: number;
  sp_week: number;
  generated_at: string;
  params: { sigma: number; hfa: number; bubble_rank: number; bubble_rating: number };
  versions: QuadsVersion[];
  backtest: null | { seasons: string; note: string; metrics: QuadsBacktestMetric[] };
  teams: QuadsTeam[];
}

/** Load the published file (or the mock when `mock` is set). Throws on failure. */
export async function loadQuads(mock: boolean, signal?: AbortSignal): Promise<QuadsFile> {
  const url = mock ? "/data/quads-mock.json" : await dataUrl("quads/quads.json", "2026");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.teams) || !Array.isArray(json.versions)) {
    throw new Error("malformed quads file");
  }
  return json as QuadsFile;
}

export const POWER4 = ["SEC", "Big Ten", "Big 12", "ACC"];
export const G5 = ["American Athletic", "American", "Conference USA", "Mid-American", "Mountain West", "Sun Belt", "Pac-12"];

export type ConfFilter = string; // "all" | "p4" | "g5" | <conference name>

export function matchesConf(team: QuadsTeam, f: ConfFilter): boolean {
  if (f === "all") return true;
  if (f === "p4") return POWER4.includes(team.conference);
  if (f === "g5") return G5.includes(team.conference);
  return team.conference === f;
}

export function fmtWL(wl: WL | undefined): string {
  return wl ? `${wl[0]}-${wl[1]}` : "0-0";
}

export function fmtSigned(n: number, digits = 1): string {
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export const SITE_WORD: Record<"H" | "A" | "N", string> = { H: "vs", A: "@", N: "N" };

export function otherVersions(v: VersionKey): VersionKey[] {
  return VERSION_KEYS.filter((k) => k !== v);
}

/** "Sep 27, 2026, 3:04 PM ET" or "" if unparsable. */
export function fmtUpdatedET(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " ET"
  );
}
