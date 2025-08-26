// src/utils/teamInfo.ts
import * as Papa from "papaparse";
import rawCsv from "../assets/team_info.csv?raw";

export type TeamInfo = {
  name: string;
  primary?: string;
  secondary?: string;
  logo?: string;        // first logo URL in Logos column
  logos?: string[];     // all logos
};

// normalize team key
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const rows = Papa.parse(rawCsv, { header: true, dynamicTyping: false, skipEmptyLines: true }).data as any[];

const infoByKey = new Map<string, TeamInfo>();

for (const r of rows) {
  if (!r) continue;
  const name = String(r.Team ?? r.team ?? r.Name ?? r.name ?? "").trim();
  if (!name) continue;
  const primary = String(r.Primary ?? r.primary ?? r.Color ?? r.color ?? "").trim() || undefined;
  const secondary = String(r.Secondary ?? r.secondary ?? r.Color2 ?? r.color2 ?? "").trim() || undefined;

  // Logos cell may be comma- or pipe-separated
  const logosCell = String(r.Logos ?? r.logos ?? "").trim();
  const logos = logosCell
    ? logosCell.split(/[|,]\s*/).map((u: string) => u.trim()).filter(Boolean)
    : [];

  infoByKey.set(key(name), {
    name,
    primary,
    secondary,
    logo: logos[0],
    logos,
  });
}

// public helpers
export function getTeamInfo(teamName: string): TeamInfo | undefined {
  const k = key(teamName);
  return infoByKey.get(k);
}

export function getTeamColors(teamName: string): { primary?: string; secondary?: string } {
  const info = getTeamInfo(teamName);
  return { primary: info?.primary, secondary: info?.secondary };
}

export function getTeamLogo(teamName: string): string | undefined {
  return getTeamInfo(teamName)?.logo;
}
