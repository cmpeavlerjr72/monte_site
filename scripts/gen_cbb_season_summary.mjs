#!/usr/bin/env node
// scripts/gen_cbb_season_summary.mjs: FREEZE a finished CBB season's headline
// (2026-10-16). Sums every day's daily_results.json `aggregate` block (all
// graded sim picks, spread / total / moneyline, flat 1u) over the season's
// date range and writes src/data/cbb_<season>_summary.json, which the CBB
// scoreboard's off-season panel shows. A finished season is immutable, so
// this runs once per season; re-run only if the dataset is republished.
//
//   node scripts/gen_cbb_season_summary.mjs 2025-11-03 2026-03-15 2025-26
import { writeFileSync } from "node:fs";
const [start = "2025-11-03", end = "2026-03-15", label = "2025-26"] = process.argv.slice(2);
const BASE = "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main/2026/days";
const days = [];
for (let d = new Date(`${start}T12:00:00Z`); d <= new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  days.push(d.toISOString().slice(0, 10));
}
const tot = { spread: { wins: 0, losses: 0, pushes: 0, units: 0 }, total: { wins: 0, losses: 0, pushes: 0, units: 0 }, ml: { wins: 0, losses: 0, pushes: 0, units: 0 } };
let graded = 0, withData = 0, games = 0;
for (let i = 0; i < days.length; i += 8) {
  await Promise.all(days.slice(i, i + 8).map(async (d) => {
    const r = await fetch(`${BASE}/${d}/daily_results.json`);
    if (!r.ok) return;
    const j = await r.json();
    withData++;
    games += Number(j?.counts?.games_total ?? 0);
    for (const m of ["spread", "total", "ml"]) {
      const a = j?.aggregate?.[m];
      if (!a) continue;
      tot[m].wins += a.wins ?? 0; tot[m].losses += a.losses ?? 0; tot[m].pushes += a.pushes ?? 0;
      tot[m].units += a.profit_units ?? 0;
      graded += a.bets_graded ?? 0;
    }
  }));
}
for (const m of Object.keys(tot)) tot[m].units = Math.round(tot[m].units * 100) / 100;
const out = { season: label, start, end, days_with_results: withData, games, markets: tot,
  source: "mvpeav/cbb-sims-2026 2026/days/*/daily_results.json, aggregate block (every graded sim pick, 1 unit flat)",
  generated_utc: new Date().toISOString() };
const path = `src/data/cbb_${label.replace(/[^0-9a-z]+/gi, "_")}_summary.json`;
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
console.log(path, JSON.stringify(out.markets), `${withData} days, ${games} games`);
