// src/components/LegPicker.tsx
//
// Cascading picker for one parlay leg, already scoped to a single game — the
// "+ Add leg" click IS the game selection, so there is no game chooser here.
//
// The game's seeds.json is fetched on first open and cached, which is what
// lets the picker show the leg's MARGINAL probability live as the line moves,
// before the leg is added.

import { useEffect, useMemo, useState } from "react";
import {
  getSeeds, SeedsNotPublished, legMarginal, legLabel, snapHalf,
  PROP_STATS, statLabel,
  type Leg, type LegSpec, type SeedsJson, type Side, type TeamRef,
} from "../lib/parlay";
import { getPlayersJson, type JsonWeekRow, type PlayersJson } from "../lib/cfbJson";
import type { Season } from "../lib/cfbData";
import { Skeleton, SkeletonLines } from "./Skeleton";

type Props = {
  row: JsonWeekRow;
  season: Season;
  weekId: string;
  teamA: string;
  teamB: string;
  /** Book numbers for pre-fill: home-perspective spread and game total. */
  marketSpread?: number;
  marketTotal?: number;
  onAdd: (leg: Leg) => void;
  onClose: () => void;
};

type BetType = "game" | "prop";
type GameMarket = "spread" | "total" | "teamTotal";

const selectStyle = { minWidth: 0 } as const;



/** Median of a numeric column, for pre-filling a line with no market number. */
function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export default function LegPicker({
  row, season, weekId, teamA, teamB, marketSpread, marketTotal, onAdd, onClose,
}: Props) {
  const [seeds, setSeeds] = useState<SeedsJson | null>(null);
  const [players, setPlayers] = useState<PlayersJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [notPublished, setNotPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let alive = true;
    setLoading(true); setError(null); setNotPublished(false);

    (async () => {
      try {
        // players.json only drives the name list + usage sort; a failure there
        // must not block game-line legs, so it is tolerated separately.
        const [s, p] = await Promise.all([
          getSeeds(row, season, ac.signal),
          getPlayersJson(row, season, ac.signal).catch(() => null),
        ]);
        if (!alive) return;
        setSeeds(s);
        setPlayers(p);
      } catch (e: any) {
        if (e?.name === "AbortError" || !alive) return;
        if (e instanceof SeedsNotPublished || e?.name === "SeedsNotPublished") setNotPublished(true);
        else { console.warn("[LegPicker] seeds failed:", e); setError(String(e?.message ?? e)); }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; ac.abort(); };
  }, [row, season]);

  const [betType, setBetType] = useState<BetType>("game");
  const [market, setMarket] = useState<GameMarket>("spread");
  const [team, setTeam] = useState<TeamRef>("A");
  const [side, setSide] = useState<Side>("over");
  const [playerName, setPlayerName] = useState("");
  const [stat, setStat] = useState("pass_yds");
  const [line, setLine] = useState("");
  const [lineTouched, setLineTouched] = useState(false);

  /** Players present in the seed file, ordered by usage (touches then name). */
  const playerOptions = useMemo(() => {
    if (!seeds) return [] as { name: string; team: string; role?: string; usage: number }[];
    const meta = new Map(
      (players?.players ?? []).map((p) => [p.player, p])
    );
    const out: { name: string; team: string; role?: string; usage: number }[] = [];
    for (const name of seeds.playerNames) {
      const m = meta.get(name);
      const g = (k: string) => m?.stats?.[k]?.mean ?? 0;
      out.push({
        name,
        team: m?.team ?? "",
        role: m?.role,
        usage: g("pass_att") + g("rush_att") + g("tgt"),
      });
    }
    // Home team first, then usage descending — the order a bettor scans.
    const rank = (t: string) => (t === teamA ? 0 : t === teamB ? 1 : 2);
    return out.sort((a, b) => rank(a.team) - rank(b.team) || b.usage - a.usage || a.name.localeCompare(b.name));
  }, [seeds, players, teamA, teamB]);

  /** Stats this player actually has a seed column for. */
  const statOptions = useMemo(() => {
    if (!seeds || !playerName) return PROP_STATS;
    const avail = PROP_STATS.filter((s) => seeds.players[`${playerName}|${s.key}`]);
    return avail.length ? avail : PROP_STATS;
  }, [seeds, playerName]);

  useEffect(() => {
    if (!playerName && playerOptions.length) setPlayerName(playerOptions[0].name);
  }, [playerOptions, playerName]);
  useEffect(() => {
    if (statOptions.length && !statOptions.some((s) => s.key === stat)) {
      setStat(statOptions[0].key);
      setLineTouched(false);
    }
  }, [statOptions, stat]);

  /**
   * Pre-fill: the market number where we know it, otherwise the sim median
   * snapped to a half-point. Half-points only, so no leg can push.
   */
  const suggestedLine = useMemo((): number | null => {
    if (!seeds) return null;
    if (betType === "game") {
      if (market === "spread") {
        if (Number.isFinite(marketSpread)) {
          const s = marketSpread as number;
          return snapHalf(team === "A" ? s : -s);
        }
        const margins = seeds.A_pts.map((a, i) => a - seeds.B_pts[i]);
        const m = medianOf(margins);
        return snapHalf(team === "A" ? -m : m);
      }
      if (market === "total") {
        if (Number.isFinite(marketTotal)) return snapHalf(marketTotal as number);
        return snapHalf(medianOf(seeds.A_pts.map((a, i) => a + seeds.B_pts[i])));
      }
      return snapHalf(medianOf(team === "A" ? seeds.A_pts : seeds.B_pts));
    }
    const col = seeds.players[`${playerName}|${stat}`];
    return snapHalf(col ? medianOf(col) : 0.5);
  }, [seeds, betType, market, team, stat, playerName, marketSpread, marketTotal]);

  useEffect(() => {
    if (suggestedLine === null || lineTouched) return;
    setLine(String(suggestedLine));
  }, [suggestedLine, lineTouched]);

  const lineNum = Number(line);
  const lineOk = line.trim() !== "" && Number.isFinite(lineNum);

  const spec = useMemo((): LegSpec | null => {
    if (!lineOk) return null;
    // Force the half-point grid regardless of what was typed.
    const L = snapHalf(lineNum);
    if (betType === "game") {
      if (market === "spread") return { kind: "spread", team, line: L };
      if (market === "total") return { kind: "total", side, line: L };
      return { kind: "teamTotal", team, side, line: L };
    }
    if (!playerName) return null;
    return { kind: "prop", player: playerName, stat, side, line: L };
  }, [lineOk, lineNum, betType, market, team, side, playerName, stat]);

  const marginal = useMemo(
    () => (seeds && spec ? legMarginal(seeds, spec) : null),
    [seeds, spec]
  );

  const bump = (d: -1 | 1) => {
    const base = Number.isFinite(lineNum) ? lineNum : 0;
    setLine(String(snapHalf(base + d))); // whole-point steps keep the .5 grid
    setLineTouched(true);
  };

  if (loading) {
    return (
      <Shell onClose={onClose}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <Skeleton height={30} width={96} /><Skeleton height={30} width={96} />
          </div>
          <SkeletonLines rows={2} height={30} gap={8} />
          <Skeleton height={34} width="60%" />
        </div>
      </Shell>
    );
  }
  if (notPublished) {
    return <Shell onClose={onClose}><span style={{ color: "var(--muted)", fontSize: 13 }}>Parlay pricing not available for this week.</span></Shell>;
  }
  if (error || !seeds) {
    return <Shell onClose={onClose}><span style={{ color: "var(--muted)", fontSize: 13 }}>Couldn’t load seeds: {error}</span></Shell>;
  }

  return (
    <Shell onClose={onClose}>
      <div style={{ display: "grid", gap: 8 }}>
        {/* bet type */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="ui-btn" data-on={betType === "game" ? "true" : "false"} onClick={() => { setBetType("game"); setLineTouched(false); }}>Game line</button>
          <button type="button" className="ui-btn" data-on={betType === "prop" ? "true" : "false"} onClick={() => { setBetType("prop"); setLineTouched(false); }}>Player prop</button>
        </div>

        {/* cascade */}
        {betType === "game" ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select value={market} onChange={(e) => { setMarket(e.target.value as GameMarket); setLineTouched(false); }} className="ui-sel" style={selectStyle}>
              <option value="spread">Spread</option>
              <option value="total">Total</option>
              <option value="teamTotal">Team total</option>
            </select>
            {(market === "spread" || market === "teamTotal") && (
              <select value={team} onChange={(e) => { setTeam(e.target.value as TeamRef); setLineTouched(false); }} className="ui-sel" style={selectStyle}>
                <option value="A">{teamA}</option>
                <option value="B">{teamB}</option>
              </select>
            )}
            {(market === "total" || market === "teamTotal") && (
              <select value={side} onChange={(e) => setSide(e.target.value as Side)} className="ui-sel" style={selectStyle}>
                <option value="over">Over</option>
                <option value="under">Under</option>
              </select>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={playerName}
              onChange={(e) => { setPlayerName(e.target.value); setLineTouched(false); }}
              className="ui-sel" style={{ ...selectStyle, maxWidth: 240 }}
            >
              {playerOptions.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.role ? ` · ${p.role}` : ""}{p.team ? ` · ${p.team}` : ""}
                </option>
              ))}
            </select>
            <select value={stat} onChange={(e) => { setStat(e.target.value); setLineTouched(false); }} className="ui-sel" style={selectStyle}>
              {statOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={side} onChange={(e) => setSide(e.target.value as Side)} className="ui-sel" style={selectStyle}>
              <option value="over">Over</option>
              <option value="under">Under</option>
            </select>
          </div>
        )}

        {/* line + live marginal */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Line:</span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button type="button" className="ui-btn" aria-label="Decrease line" onClick={() => bump(-1)} style={{ padding: "3px 8px" }}>−</button>
            <input
              type="number" step={1} value={line} inputMode="decimal"
              onChange={(e) => { setLine(e.target.value); setLineTouched(true); }}
              onBlur={() => { if (lineOk) setLine(String(snapHalf(lineNum))); }}
              style={{ width: 92, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            />
            <button type="button" className="ui-btn" aria-label="Increase line" onClick={() => bump(1)} style={{ padding: "3px 8px" }}>+</button>
          </div>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>half-points only</span>

          <span style={{ marginLeft: "auto", fontSize: 13 }}>
            {marginal === null ? (
              <span style={{ color: "var(--muted)" }}>—</span>
            ) : (
              <>
                <span style={{ color: "var(--muted)" }}>this leg </span>
                <b style={{ fontSize: 16 }}>{(marginal * 100).toFixed(1)}%</b>
                <span style={{ color: "var(--muted)", fontSize: 11 }}> of {seeds.nsims} sims</span>
              </>
            )}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!spec}
            onClick={() => {
              if (!spec) return;
              onAdd({
                id: `${row.slug}:${JSON.stringify(spec)}`,
                season, weekId, slug: row.slug, teamA, teamB, row, spec,
                label: legLabel(spec, teamA, teamB),
              });
              onClose();
            }}
            className="ui-btn"
            data-on={spec ? "true" : "false"}
            style={{ padding: "8px 14px", fontWeight: 700 }}
          >
            Add to slip
          </button>
          {spec && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {legLabel(spec, teamA, teamB)}
            </span>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="card" style={{ padding: 10, marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--brand-text)", letterSpacing: 0.4 }}>ADD LEG</span>
        <button
          type="button" onClick={onClose} className="ui-btn"
          style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 12 }}
        >
          Close
        </button>
      </div>
      {children}
    </div>
  );
}
