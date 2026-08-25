// Team logo lookup, shared by the scoreboard cards and the parlay slip.
//
// Was a private LOGO_MAP inside Scoreboard.tsx; the slip needs the same
// mapping, so it lives here rather than being duplicated. Logos resolve to the
// self-hosted /logos/<espnId>.webp copies (see scripts/fetch_logos.py) so the
// page renders on networks that block espncdn.com.

import * as Papa from "papaparse";
import teamInfoRaw from "../assets/team_info.csv?raw";
import { localizeLogoUrl } from "./espnLogos";

export function normTeamKey(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.\b/g, "state")
    .replace(/[^a-z0-9]+/g, "");
}

function firstLogoFromCell(cell?: string): string | undefined {
  if (!cell) return undefined;
  for (const part of String(cell).split(/[|,;\s]+/).filter(Boolean)) {
    const fixed = localizeLogoUrl(part);
    if (fixed?.startsWith("/logos/") || fixed?.startsWith("https://")) return fixed;
  }
  return undefined;
}

let LOGO_MAP: Record<string, string> | null = null;

function loadOnce(): Record<string, string> {
  if (LOGO_MAP) return LOGO_MAP;
  const map: Record<string, string> = {};
  if (teamInfoRaw) {
    const parsed = Papa.parse(teamInfoRaw, { header: true, skipEmptyLines: true });
    for (const row of parsed.data as any[]) {
      if (!row) continue;
      const name = row.Team ?? row.team ?? row.School ?? row.school ?? row.Name ?? row.name;
      const key = name ? normTeamKey(String(name)) : "";
      if (!key) continue;
      const logo = firstLogoFromCell(row.Logos ?? row.logo ?? row.Logo ?? row.logos);
      if (logo) map[key] = logo;
      // Alternate names let Kalshi/ESPN spellings resolve too.
      const alts = String(row.AlternateNames ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      for (const a of alts) {
        const k = normTeamKey(a);
        if (k && logo && !map[k]) map[k] = logo;
      }
    }
  }
  LOGO_MAP = map;
  return map;
}

export function getTeamLogo(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  return loadOnce()[normTeamKey(String(name))];
}
