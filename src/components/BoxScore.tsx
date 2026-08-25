// src/components/BoxScore.tsx
//
// A CBS-gametracker-style projected box score for one simulated game.
//
// Data is the game's players.json (per-player mean + p10/p25/p50/p75/p90 for
// each stat), fetched the first time the panel is opened and cached by the
// parent card. Values follow the page's Mean|Median toggle: median (p50) by
// default, mean when the toggle says mean.
//
// Sims have no quarters and no long-gain, so the header is total points only
// and the tables drop CBS's LG column.

import { useEffect, useMemo, useState } from "react";
import {
  getPlayersJson, type JsonWeekRow, type PlayerJson, type PlayersJson, type StatDist,
} from "../lib/cfbJson";
import type { Season } from "../lib/cfbData";

type Props = {
  row: JsonWeekRow;
  season: Season;
  /** Home. */
  teamA: string;
  /** Away. */
  teamB: string;
  /** Projected points, straight from summary.json — NOT summed from players. */
  ptsA: number;
  ptsB: number;
  useMean: boolean;
  logoFor: (team: string) => string | undefined;
  colorFor: (team: string) => string | undefined;
};

/** Pull the toggled value out of a stat block. */
const val = (s: StatDist | undefined, useMean: boolean): number => {
  if (!s) return 0;
  const v = useMean ? s.mean : s.p50;
  return Number.isFinite(v) ? (v as number) : 0;
};

/**
 * TD and INT ALWAYS read the mean, in both toggle states.
 *
 * These are small integer counts, so their median is a whole number for
 * essentially every player — a 0.4-TD projection and a 0.0-TD projection both
 * render as "0" in median mode, which erases the entire betting signal. The
 * mean at one decimal is the only readout that carries it.
 */
const meanVal = (s: StatDist | undefined): number =>
  Number.isFinite(s?.mean) ? (s!.mean as number) : 0;

const r0 = (n: number) => Math.round(n);
const d1 = (n: number) => n.toFixed(1);

const MAX_ROWS = 6;

type Row = { key: string; name: string; cells: (string | number)[]; sortBy: number };

function passingRows(players: PlayerJson[], useMean: boolean): Row[] {
  return players
    .map((p) => {
      const att = val(p.stats.pass_att, useMean);
      const cmp = val(p.stats.pass_comp, useMean);
      const yds = val(p.stats.pass_yds, useMean);
      const td = meanVal(p.stats.pass_td);   // always mean — see meanVal
      const int = meanVal(p.stats.int);      // always mean — see meanVal
      return {
        key: p.player,
        name: p.player,
        cells: [`${r0(cmp)}/${r0(att)}`, r0(yds), d1(td), d1(int)],
        sortBy: yds,
        drop: r0(att) === 0 && r0(yds) === 0 && td === 0 && int === 0,
      };
    })
    .filter((r) => !r.drop)
    .sort((a, b) => b.sortBy - a.sortBy)
    .slice(0, MAX_ROWS);
}

function rushingRows(players: PlayerJson[], useMean: boolean): Row[] {
  return players
    .map((p) => {
      const att = val(p.stats.rush_att, useMean);
      const yds = val(p.stats.rush_yds, useMean);
      const td = meanVal(p.stats.rush_td);   // always mean — see meanVal
      return {
        key: p.player,
        name: p.player,
        cells: [r0(att), r0(yds), d1(td)],
        sortBy: yds,
        drop: r0(att) === 0 && r0(yds) === 0 && td === 0,
      };
    })
    .filter((r) => !r.drop)
    .sort((a, b) => b.sortBy - a.sortBy)
    .slice(0, MAX_ROWS);
}

function receivingRows(players: PlayerJson[], useMean: boolean): Row[] {
  return players
    .map((p) => {
      const rec = val(p.stats.rec, useMean);
      const yds = val(p.stats.rec_yds, useMean);
      const td = meanVal(p.stats.rec_td);    // always mean — see meanVal
      return {
        key: p.player,
        name: p.player,
        cells: [r0(rec), r0(yds), d1(td)],
        sortBy: yds,
        drop: r0(rec) === 0 && r0(yds) === 0 && td === 0,
      };
    })
    .filter((r) => !r.drop)
    .sort((a, b) => b.sortBy - a.sortBy)
    .slice(0, MAX_ROWS);
}

/**
 * Team yardage for the comparison bars.
 *
 * DELIBERATE APPROXIMATION: this sums the same per-player values the tables
 * display, and a sum of medians is not the median of the sum. The exact team
 * distributions live in compact.json's quantiles; these bars are a readout of
 * the roster table, not a claim about the team total. Header points come from
 * summary.json instead, which is why they will not equal pass+rush here.
 *
 * Receiving yards are omitted on purpose — they are the same yards as passing
 * yards, counted on the other end.
 */
function teamYards(players: PlayerJson[], useMean: boolean) {
  let pass = 0;
  let rush = 0;
  for (const p of players) {
    pass += val(p.stats.pass_yds, useMean);
    rush += val(p.stats.rush_yds, useMean);
  }
  return { pass: r0(pass), rush: r0(rush), total: r0(pass + rush) };
}

/* ------------------------------- presentation ------------------------------ */

function StatTable({
  title, columns, rows,
}: {
  title: string;
  columns: string[];
  rows: Row[];
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, minmax(30px, auto))`,
          gap: 6,
          padding: "6px 8px",
          background: "color-mix(in oklab, var(--border) 35%, transparent)",
          borderRadius: 6,
          fontSize: 11,
          letterSpacing: 0.6,
          color: "var(--muted)",
          textTransform: "uppercase",
        }}
      >
        <div>{title}</div>
        {columns.map((c) => (
          <div key={c} style={{ textAlign: "right" }}>{c}</div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "8px", fontSize: 12, color: "var(--muted)" }}>—</div>
      ) : (
        rows.map((r) => (
          <div
            key={r.key}
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(0,1fr) repeat(${r.cells.length}, minmax(30px, auto))`,
              gap: 6,
              padding: "7px 8px",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={r.name}
            >
              {r.name}
            </div>
            {r.cells.map((c, i) => (
              <div key={i} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {c}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** One mirrored comparison row: away bar grows leftward, home bar rightward. */
function CompareRow({
  label, left, right, leftColor, rightColor,
}: {
  label: string;
  left: number;
  right: number;
  leftColor: string;
  rightColor: string;
}) {
  const max = Math.max(left, right, 1);
  const track = {
    flex: 1,
    height: 10,
    borderRadius: 999,
    background: "color-mix(in oklab, var(--border) 60%, transparent)",
    overflow: "hidden",
    display: "flex",
  } as const;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 48px 110px 48px minmax(0,1fr)",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
      }}
    >
      <div style={{ ...track, justifyContent: "flex-end" }}>
        <div style={{ width: `${(left / max) * 100}%`, background: leftColor }} />
      </div>
      <div style={{ textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {left}
      </div>
      <div
        style={{
          textAlign: "center",
          fontSize: 11,
          letterSpacing: 0.6,
          color: "var(--muted)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ textAlign: "left", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {right}
      </div>
      <div style={{ ...track, justifyContent: "flex-start" }}>
        <div style={{ width: `${(right / max) * 100}%`, background: rightColor }} />
      </div>
    </div>
  );
}

function TeamHeading({
  team, logo, pts, align,
}: {
  team: string;
  logo?: string;
  pts: number;
  align: "left" | "right";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexDirection: align === "right" ? "row-reverse" : "row",
      }}
    >
      {logo && (
        <img src={logo} alt="" width={22} height={22} style={{ objectFit: "contain" }} loading="lazy" />
      )}
      <div
        style={{
          fontWeight: 800,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {team}
      </div>
      <div style={{ fontWeight: 800, fontSize: 18, opacity: 0.85 }}>{pts}</div>
    </div>
  );
}

/* ----------------------------------- view ----------------------------------- */

type ViewProps = Omit<Props, "row" | "season"> & { data: PlayersJson | null };

/** Pure presentation — no fetching, so it can be rendered from any source. */
export function BoxScoreView({
  data, teamA, teamB, ptsA, ptsB, useMean, logoFor, colorFor,
}: ViewProps) {
  // Team names in players.json should match the index; fall back to a loose
  // match so a punctuation difference does not blank a whole column.
  const byTeam = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const all = data?.players ?? [];
    const pick = (want: string) => {
      const w = norm(want);
      const exact = all.filter((p) => p.team === want);
      return exact.length ? exact : all.filter((p) => norm(p.team) === w);
    };
    return { home: pick(teamA), away: pick(teamB) };
  }, [data, teamA, teamB]);

  const homeY = useMemo(() => teamYards(byTeam.home, useMean), [byTeam.home, useMean]);
  const awayY = useMemo(() => teamYards(byTeam.away, useMean), [byTeam.away, useMean]);

  if (!data || !data.players.length) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        No player projections published for this game.
      </div>
    );
  }

  const awayColor = colorFor(teamB) ?? "var(--accent)";
  const homeColor = colorFor(teamA) ?? "var(--brand)";

  const column = (players: PlayerJson[], team: string, align: "left" | "right", pts: number) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ marginBottom: 10 }}>
        <TeamHeading team={team} logo={logoFor(team)} pts={pts} align={align} />
      </div>
      <StatTable
        title="Passing"
        columns={["CP/ATT", "YDS", "TD", "INT"]}
        rows={passingRows(players, useMean)}
      />
      <StatTable
        title="Rushing"
        columns={["ATT", "YDS", "TD"]}
        rows={rushingRows(players, useMean)}
      />
      <StatTable
        title="Receiving"
        columns={["REC", "YDS", "TD"]}
        rows={receivingRows(players, useMean)}
      />
    </div>
  );

  return (
    <div className="card" style={{ padding: 12, marginTop: 6 }}>
      {/* Header: totals only — sims do not carry quarters. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: 12,
          paddingBottom: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <TeamHeading team={teamB} logo={logoFor(teamB)} pts={ptsB} align="left" />
        <TeamHeading team={teamA} logo={logoFor(teamA)} pts={ptsA} align="right" />
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 0 2px" }}>
        Projected · {useMean ? "mean" : "median"} of {data.nSims ?? "—"} sims
      </div>

      {/* Team comparison */}
      <div style={{ padding: "4px 0 10px", borderBottom: "1px solid var(--border)" }}>
        <CompareRow label="Pass Yds" left={awayY.pass} right={homeY.pass} leftColor={awayColor} rightColor={homeColor} />
        <CompareRow label="Rush Yds" left={awayY.rush} right={homeY.rush} leftColor={awayColor} rightColor={homeColor} />
        <CompareRow label="Total Yds" left={awayY.total} right={homeY.total} leftColor={awayColor} rightColor={homeColor} />
      </div>

      {/* Away | Home */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
          paddingTop: 12,
        }}
      >
        {column(byTeam.away, teamB, "left", ptsB)}
        {column(byTeam.home, teamA, "right", ptsA)}
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", paddingTop: 4 }}>
        TD &amp; INT are averages across sims.
      </div>
    </div>
  );
}

/* ---------------------------------- panel ---------------------------------- */

/** Fetches the game's players.json once, then hands it to the view. */
export default function BoxScore({ row, season, ...rest }: Props) {
  const [data, setData] = useState<PlayersJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const json = await getPlayersJson(row, season, ac.signal);
        if (alive) setData(json);
      } catch (e: any) {
        if (e?.name === "AbortError" || !alive) return;
        console.warn("[BoxScore] players.json failed:", e);
        setError(String(e?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; ac.abort(); };
  }, [row, season]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        Loading projected box score…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        Couldn’t load the box score: {error}
      </div>
    );
  }

  return <BoxScoreView data={data} {...rest} />;
}
