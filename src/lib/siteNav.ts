// src/lib/siteNav.ts: THE SITE MAP, in one place (2026-10-16).
//
// The header, the mobile menu, the footer and the /labs index all read these
// lists, so a page is added or hidden in exactly one spot. Main nav is one
// entry per PROJECT (CFB, CBB, Fantasy AI), then Blog and About, the way a
// sports site lists its sports (owner 2026-10-16: modelled on cbssports.com).
// Each sport opens on its own home page (its posts + a score ticker) with the
// board one tab over. Labs holds the side projects, whose old URLs (/mlb,
// /nascar, /tennis, /college-baseball) keep working unchanged.

import { GATES, isOpen } from "./seasons";

export type NavItem = { to: string; label: string; end?: boolean };
export type Section = "blog" | "cfb" | "cbb" | "fantasy-ai" | "about" | "labs" | "account" | null;

export const MAIN_NAV: Array<NavItem & { section: Exclude<Section, null> }> = [
  { to: "/cfb", label: "CFB", section: "cfb" },
  { to: "/cbb", label: "CBB", section: "cbb" },
  { to: "/fantasy-ai", label: "Fantasy AI", section: "fantasy-ai" },
  { to: "/blog", label: "Blog", section: "blog" },
  { to: "/about", label: "About", section: "about" },
];

/** CFB sub-pages. The bracket appears on Selection Sunday. */
export function cfbNav(): NavItem[] {
  return [
    { to: "/cfb", label: "Home", end: true },
    { to: "/cfb/scoreboard", label: "Scoreboard" },
    { to: "/cfb/record", label: "Record" },
    { to: "/cfb/quads", label: "Quads" },
    ...(isOpen(GATES.cfbBracket) ? [{ to: "/cfb/bracket", label: "Bracket" }] : []),
  ];
}

export function cbbNav(): NavItem[] {
  return [
    { to: "/cbb", label: "Home", end: true },
    { to: "/cbb/scoreboard", label: "Scoreboard" },
    { to: "/cbb/results", label: "Results" },
    ...(isOpen(GATES.cbbBracket) ? [{ to: "/cbb/bracket", label: "Bracket" }] : []),
  ];
}

export type LabsProject = {
  id: string; name: string; prefix: string; home: string; blurb: string; pages: NavItem[];
};

export const LABS: LabsProject[] = [
  {
    id: "mlb", name: "MLB", prefix: "/mlb", home: "/mlb/scoreboard",
    blurb: "Daily game sims with first-five lines, pitcher strikeouts and batter props.",
    pages: [{ to: "/mlb/scoreboard", label: "Scoreboard" }],
  },
  {
    id: "nascar", name: "NASCAR", prefix: "/nascar", home: "/nascar/live",
    blurb: "Live race tracker, a win and top-N model, and a team-radio scanner.",
    pages: [
      { to: "/nascar/live", label: "Live" },
      { to: "/nascar/predictions", label: "Predictions" },
      { to: "/nascar/scanner", label: "Scanner" },
    ],
  },
  {
    id: "tennis", name: "Tennis", prefix: "/tennis", home: "/tennis/predictions",
    blurb: "ATP, WTA and Challenger match predictions, refreshed daily.",
    pages: [{ to: "/tennis/predictions", label: "Predictions" }],
  },
  {
    id: "college-baseball", name: "College Baseball", prefix: "/college-baseball", home: "/college-baseball/scoreboard",
    blurb: "A live college baseball scoreboard. In season February to June.",
    pages: [{ to: "/college-baseball/scoreboard", label: "Scoreboard" }],
  },
];

/** Which top-level section a path belongs to (drives the gold underline). */
export function sectionOf(pathname: string): Section {
  if (pathname === "/fantasy-ai") return "fantasy-ai";
  if (pathname.startsWith("/blog") || pathname === "/nhl") return "blog";
  if (pathname.startsWith("/cfb")) return "cfb";
  if (pathname.startsWith("/cbb")) return "cbb";
  if (pathname.startsWith("/about")) return "about";
  if (pathname.startsWith("/labs") || LABS.some((l) => pathname.startsWith(l.prefix))) return "labs";
  if (/^\/(mybook|feed|me|u\/)/.test(pathname)) return "account";
  return null;
}

export function labsProjectOf(pathname: string): LabsProject | undefined {
  return LABS.find((l) => pathname.startsWith(l.prefix));
}
