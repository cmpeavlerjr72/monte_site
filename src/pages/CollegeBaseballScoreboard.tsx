import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cbQuery } from "../lib/supabaseCollegeBaseball";
import "./CollegeBaseball.css";

interface Team { id: number; name: string; short_name: string; mascot: string; logo_espn: string | null; color_primary: string | null; }
interface Game { id: number; status: string; inning: number | null; inning_half: string | null; outs: number | null; balls: number | null; strikes: number | null; runner_first: boolean; runner_second: boolean; runner_third: boolean; home_team_id: number; away_team_id: number; home_score: number | null; away_score: number | null; home_hits: number | null; away_hits: number | null; home_errors: number | null; away_errors: number | null; current_batter_name: string | null; current_batter_number: string | null; current_pitcher_name: string | null; current_pitcher_number: string | null; start_time: string | null; start_time_display: string | null; sb_event_id: string | null; game_date: string | null; }

export default function CollegeBaseballScoreboard() {
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Record<number, Team>>({});
  const [linescores, setLinescores] = useState<Record<number, Record<number, Record<number, number>>>>({});
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    async function load() {
      const [g, t, ls] = await Promise.all([
        cbQuery("games", { select: "*", order: "status.desc,start_time.asc.nullslast,id" }),
        cbQuery("teams", { select: "id,name,short_name,mascot,logo_espn,color_primary" }),
        cbQuery("game_linescores", { select: "game_id,team_id,inning,runs", order: "game_id,team_id,inning", limit: "10000" }),
      ]);
      const tm: Record<number, Team> = {};
      t.forEach((team: Team) => { tm[team.id] = team; });
      const lsMap: Record<number, Record<number, Record<number, number>>> = {};
      ls.forEach((l: { game_id: number; team_id: number; inning: number; runs: number }) => {
        if (!lsMap[l.game_id]) lsMap[l.game_id] = {};
        if (!lsMap[l.game_id][l.team_id]) lsMap[l.game_id][l.team_id] = {};
        lsMap[l.game_id][l.team_id][l.inning] = l.runs;
      });
      setGames(g); setTeams(tm); setLinescores(lsMap); setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="cb-loading">Loading scores...</div>;

  const statusOrder: Record<string, number> = { live: 0, pre: 1, scheduled: 2, final: 3 };
  const sorted = [...games].sort((a, b) => {
    const sa = statusOrder[a.status] ?? 2, sb = statusOrder[b.status] ?? 2;
    if (sa !== sb) return sa - sb;
    return (a.start_time || "").localeCompare(b.start_time || "");
  });
  const filtered = filter === "all" ? sorted : sorted.filter(g => g.status === filter);
  const counts: Record<string, number> = {};
  games.forEach(g => { counts[g.status] = (counts[g.status] || 0) + 1; });

  const team = (id: number) => teams[id] || {} as Team;
  const abbr = (id: number) => team(id).short_name || team(id).name?.split(" ")[0] || "?";
  const fullName = (id: number) => team(id).name || "?";
  const logo = (id: number) => team(id).logo_espn || null;
  const color = (id: number) => { const c = team(id).color_primary; return c ? `#${c}` : null; };

  const gameStatus = (g: Game) => {
    if (g.status === "final") return "Final";
    if (g.status === "live") {
      if (!g.inning) return "Live";
      return `${g.inning_half === "top" ? "Top" : "Bot"} ${g.inning}`;
    }
    return g.start_time_display || "TBD";
  };
  const isWinner = (g: Game, side: "away" | "home") => {
    if (g.status !== "final") return false;
    return side === "away" ? (g.away_score ?? 0) > (g.home_score ?? 0) : (g.home_score ?? 0) > (g.away_score ?? 0);
  };
  const getInnings = (gameId: number, teamId: number) => {
    const data = linescores[gameId]?.[teamId];
    if (!data) return [] as (number | null)[];
    const max = Math.max(...Object.keys(data).map(Number));
    return Array.from({ length: max }, (_, i) => data[i + 1] ?? null);
  };

  return (
    <div className="cb-scoreboard">
      {/* Ticker strip */}
      <div className="cb-strip">
        {sorted.filter(g => g.status === "live" || g.status === "final").slice(0, 20).map(g => (
          <div key={g.id} className="cb-chip" onClick={() => nav(`/college-baseball/game/${g.id}`)}>
            <div className={`cb-chip-status ${g.status}`}>{gameStatus(g)}</div>
            <div className="cb-chip-team">
              {logo(g.away_team_id) && <img src={logo(g.away_team_id)!} className="cb-chip-logo" alt="" />}
              <span className="cb-chip-name">{abbr(g.away_team_id)}</span>
              <span className={`cb-chip-score ${isWinner(g, "away") ? "w" : ""}`}>{g.away_score ?? "-"}</span>
            </div>
            <div className="cb-chip-team">
              {logo(g.home_team_id) && <img src={logo(g.home_team_id)!} className="cb-chip-logo" alt="" />}
              <span className="cb-chip-name">{abbr(g.home_team_id)}</span>
              <span className={`cb-chip-score ${isWinner(g, "home") ? "w" : ""}`}>{g.home_score ?? "-"}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Header + filter */}
      <h2 className="cb-section-title">Scores</h2>
      <div className="cb-filter-bar">
        <label>Filter</label>
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All Games ({games.length})</option>
          {Object.entries(counts).sort((a, b) => (statusOrder[a[0]] ?? 9) - (statusOrder[b[0]] ?? 9)).map(([s, c]) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)} ({c})</option>
          ))}
        </select>
      </div>

      {/* Game cards */}
      <div className="cb-game-cards">
        {filtered.map(g => {
          const awayInn = getInnings(g.id, g.away_team_id);
          const homeInn = getInnings(g.id, g.home_team_id);
          const maxInn = Math.max(awayInn.length, homeInn.length, 9);
          const hasMatchup = g.current_batter_name || g.current_pitcher_name;
          return (
            <div key={g.id} className="cb-game-card" onClick={() => nav(`/college-baseball/game/${g.id}`)}
              style={{ borderLeft: `4px solid ${color(g.home_team_id) || "var(--border)"}` }}>
              <div className={`cb-gc-status ${g.status}`}>{gameStatus(g)}</div>
              <div className="cb-gc-teams">
                {(["away", "home"] as const).map(side => {
                  const tid = side === "away" ? g.away_team_id : g.home_team_id;
                  const won = isWinner(g, side);
                  const lost = g.status === "final" && !won;
                  const score = side === "away" ? g.away_score : g.home_score;
                  return (
                    <div key={side} className={`cb-gc-team-row ${won ? "won" : lost ? "lost" : ""}`}>
                      {logo(tid) && <img src={logo(tid)!} className="cb-team-logo" alt="" />}
                      <span className="cb-gc-abbr">{abbr(tid)}</span>
                      <span className="cb-gc-full">{fullName(tid)}</span>
                      <span className={`cb-gc-score ${won ? "w" : lost ? "l" : ""}`}>{score ?? "-"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="cb-gc-linescore">
                {([g.away_team_id, g.home_team_id]).map(tid => (
                  <div key={tid} className="cb-ls-row">
                    {Array.from({ length: Math.min(maxInn, 9) }, (_, i) => {
                      const inn = tid === g.away_team_id ? awayInn : homeInn;
                      return <span key={i} className={`cb-ls-cell ${(inn[i] || 0) > 0 ? "runs" : ""}`}>{inn[i] ?? "-"}</span>;
                    })}
                  </div>
                ))}
              </div>
              <div className="cb-gc-rhe">
                <div className="cb-rhe-hdr"><span>R</span><span>H</span><span>E</span></div>
                <div className="cb-rhe-row"><span>{g.away_score ?? "-"}</span><span>{g.away_hits ?? "-"}</span><span>{g.away_errors ?? "-"}</span></div>
                <div className="cb-rhe-row"><span>{g.home_score ?? "-"}</span><span>{g.home_hits ?? "-"}</span><span>{g.home_errors ?? "-"}</span></div>
              </div>
              {g.status === "live" && hasMatchup && (
                <div className="cb-gc-matchup">
                  {g.current_batter_name && <span>AB: <strong>#{g.current_batter_number} {g.current_batter_name}</strong></span>}
                  {g.current_batter_name && g.current_pitcher_name && " | "}
                  {g.current_pitcher_name && <span>P: <strong>#{g.current_pitcher_number} {g.current_pitcher_name}</strong></span>}
                  {g.outs != null && <span> | {g.outs} out</span>}
                  {g.balls != null && <span> | {g.balls}-{g.strikes}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
