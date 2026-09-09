// src/lib/flares.ts
//
// PROFILE FLARES — school logos beside a username (owner 2026-09-09).
//
// A flare is A SCHOOL YOU RIDE WITH, and nothing else. There is no badge
// catalog: the owner cut it (2026-09-08, 10:45 PM) so the row beside a name
// reads as a set of teams rather than a mixed bag of emoji and logos.
//
// AT MOST THREE, and the database enforces the count
// (`cardinality(flares) <= 3` in supabase/migrations/20260909_flares.sql).
// This file is what makes a picker offer only schools we can actually draw.
//
// THEY SAY NOTHING ABOUT MONEY. That is why they are readable across the
// friend graph like a handle or an avatar emoji, and why they live on
// `profiles` rather than behind the settings RPCs: a flare is taste, and the
// standing rule (owner 2026-09-08) is about a bettor's dollars.
//
// STORAGE IS ONE STRING PER FLARE, kind-prefixed:
//   `team:Texas Tech` — the school as team_info.csv spells it, so
//                       `getTeamLogo` resolves it with no second mapping.
// The prefix is kept even though there is only one kind today: it is what
// lets a future kind arrive without every stored row becoming ambiguous, and
// an unrecognised prefix already renders as nothing rather than as a broken
// chip.
//
// BOTH DIVISIONS. FBS and FCS both have slates on this site, and the school
// list is the FBS+FCS rows of team_info.csv — the same file the FCS
// scoreboard's logos come out of.

import { collegeSchools, getTeamLogo } from "../utils/teamLogo";

/** The hard cap, restated from the DB CHECK so an editor can say no before the
 *  database does. */
export const MAX_FLARES = 3;

export const teamFlare = (school: string) => `team:${school}`;

/** What one stored string MEANS, for display. `null` for anything this build
 *  cannot draw — an unknown prefix, or a school with no logo. */
export type FlareView = {
  kind: "team";
  value: string;
  team: string;
  logo: string;
  title: string;
};

export function readFlare(value: string): FlareView | null {
  if (typeof value !== "string") return null;
  const i = value.indexOf(":");
  if (i <= 0) return null;
  if (value.slice(0, i) !== "team") return null;
  const school = value.slice(i + 1).trim();
  if (!school) return null;
  const logo = getTeamLogo(school);
  // A school with no logo would render as an invisible chip, and the picture
  // IS the flare — so it is neither offered nor shown.
  return logo ? { kind: "team", value, team: school, logo, title: school } : null;
}

/** Client-side validation for the SAVE path: every entry must be something
 *  this catalog can draw, no duplicates, at most three. The DB guards the
 *  count regardless (a clamp in a browser is a courtesy, not a rule). */
export function validFlares(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    if (out.includes(v)) continue;
    if (readFlare(v)) out.push(v);
    if (out.length >= MAX_FLARES) break;
  }
  return out;
}

/** The schools a picker offers: every FBS or FCS team we hold a logo for. */
export function teamFlareOptions(): string[] {
  return collegeSchools();
}
