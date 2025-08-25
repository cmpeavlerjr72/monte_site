// src/utils/teamColors.ts
import * as Papa from "papaparse";
// Vite: ?raw imports the file contents at build time
import teamInfoRaw from "../assets/team_info.csv?raw";

export type TeamColor = { primary: string; secondary?: string };

const cache: Record<string, TeamColor> = {};
let loaded = false;

function norm(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function toHex(x: any) {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(t)) return undefined;
  return t.startsWith("#") ? t : `#${t}`;
}

function loadOnce() {
  if (loaded) return;
  const { data } = Papa.parse(teamInfoRaw, { header: true, dynamicTyping: false, skipEmptyLines: true });
  for (const row of (data as any[])) {
    if (!row) continue;
    const name =
      row.team ?? row.Team ?? row.school ?? row.School ?? row.name ?? row.Name;
    const p =
      row.primary ?? row.Primary ?? row.primary_color ?? row.color ?? row.Color ?? row.Hex ?? row.hex ?? row.hex_primary;
    const s =
      row.secondary ?? row.Secondary ?? row.secondary_color ?? row.Color2 ?? row.color2 ?? row.hex_secondary ?? row.Hex2;
    if (!name) continue;
    const key = norm(String(name));
    const primary = toHex(p);
    const secondary = toHex(s);
    if (primary) cache[key] = { primary, secondary };
  }
  loaded = true;
}

export function getTeamColors(teamName: string | undefined | null): TeamColor | undefined {
  if (!teamName) return undefined;
  loadOnce();
  return cache[norm(teamName)];
}
