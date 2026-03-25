import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cbQuery } from "../lib/supabaseCollegeBaseball";
import "./CollegeBaseball.css";

export default function CollegeBaseballGame() {
  const { id } = useParams();
  const gameId = Number(id);
  const nav = useNavigate();
  const [game, setGame] = useState<any>(null);
  const [teams, setTeams] = useState<Record<number, any>>({});
  const [batting, setBatting] = useState<any[]>([]);
  const [pitching, setPitching] = useState<any[]>([]);
  const [linescores, setLinescores] = useState<any[]>([]);
  const [tab, setTab] = useState("box");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [g, t, b, p, ls] = await Promise.all([
        cbQuery("games", { select: "*", id: `eq.${gameId}` }),
        cbQuery("teams", { select: "id,name,short_name,mascot,logo_espn,color_primary" }),
        cbQuery("game_batting_stats", { select: "*", game_id: `eq.${gameId}`, order: "team_id,lineup_position" }),
        cbQuery("game_pitching_stats", { select: "*", game_id: `eq.${gameId}`, order: "team_id,id" }),
        cbQuery("game_linescores", { select: "*", game_id: `eq.${gameId}`, order: "team_id,inning" }),
      ]);
      const tm: Record<number, any> = {};
      t.forEach((team: any) => { tm[team.id] = team; });
      setGame(g[0] || null); setTeams(tm); setBatting(b); setPitching(p); setLinescores(ls); setLoading(false);
    }
    load();
  }, [gameId]);

  if (loading) return <div className="cb-loading">Loading game...</div>;
  if (!game) return <div className="cb-loading">Game not found</div>;

  const away = teams[game.away_team_id] || {};
  const home = teams[game.home_team_id] || {};
  const a = (t: any) => t.short_name || t.name?.split(" ")[0] || "?";
  const f = (t: any) => t.name || "?";
  const lg = (t: any) => t.logo_espn || null;
  const tc = (t: any) => t.color_primary ? `#${t.color_primary}` : "var(--brand)";

  const awayWon = game.status === "final" && (game.away_score ?? 0) > (game.home_score ?? 0);
  const homeWon = game.status === "final" && (game.home_score ?? 0) > (game.away_score ?? 0);

  const lsByTeam: Record<number, Record<number, number>> = {};
  linescores.forEach((ls: any) => { if (!lsByTeam[ls.team_id]) lsByTeam[ls.team_id] = {}; lsByTeam[ls.team_id][ls.inning] = ls.runs; });
  const maxInn = Math.max(9, ...linescores.map((ls: any) => ls.inning));
  const innings = Array.from({ length: maxInn }, (_, i) => i + 1);

  const groupBy = (arr: any[]) => {
    const m: Record<number, any[]> = {};
    arr.forEach(r => { if (!m[r.team_id]) m[r.team_id] = []; m[r.team_id].push(r); });
    return m;
  };
  const battingByTeam = groupBy(batting);
  const pitchingByTeam = groupBy(pitching);
  const teamOrder = [game.away_team_id, game.home_team_id].filter(Boolean) as number[];

  const ordinal = (n: number) => n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  const stateText = () => {
    if (game.status === "final") return "Final";
    if (game.status === "live") {
      if (!game.inning) return "In Progress";
      const half = game.inning_half === "top" ? "Top" : "Bottom";
      return `${half} of the ${game.inning}${ordinal(game.inning)}`;
    }
    return game.start_time_display || game.status;
  };

  const totals = (players: any[], fields: string[]) => {
    const t: Record<string, number> = {};
    fields.forEach(fld => { t[fld] = players.reduce((s, p) => s + (p[fld] || 0), 0); });
    return t;
  };

  return (
    <div className="cb-game-page">
      <button className="cb-back" onClick={() => nav("/college-baseball/scoreboard")}>&larr; Back to Scores</button>

      {/* Header */}
      <div className="cb-gp-header" style={{ background: `linear-gradient(135deg, ${tc(away)}dd 0%, var(--brand) 50%, ${tc(home)}dd 100%)` }}>
        <div className="cb-gp-matchup">
          <div className="cb-gp-team">
            {lg(away) && <img src={lg(away)} className="cb-gp-logo" alt="" />}
            <div className="cb-gp-team-name">{a(away)}</div>
            <div className="cb-gp-team-full">{f(away)}</div>
          </div>
          <div className="cb-gp-score-area">
            <div className="cb-gp-scores">
              <span className={awayWon ? "w" : game.status === "final" ? "l" : ""}>{game.away_score ?? 0}</span>
              <span className="d">-</span>
              <span className={homeWon ? "w" : game.status === "final" ? "l" : ""}>{game.home_score ?? 0}</span>
            </div>
            <div className={`cb-gp-state ${game.status}`}>{stateText()}</div>
          </div>
          <div className="cb-gp-team">
            {lg(home) && <img src={lg(home)} className="cb-gp-logo" alt="" />}
            <div className="cb-gp-team-name">{a(home)}</div>
            <div className="cb-gp-team-full">{f(home)}</div>
          </div>
        </div>
        <div className="cb-gp-meta">
          {game.game_date}{game.start_time_display ? ` | ${game.start_time_display}` : ""}
          {game.venue_name ? ` | ${game.venue_name}` : ""}{game.venue_city ? `, ${game.venue_city}` : ""}
        </div>
      </div>

      {/* Situation */}
      {game.status === "live" && (
        <>
          {(game.current_batter_name || game.current_pitcher_name) && (
            <div className="cb-matchup-bar">
              {game.current_batter_name && <div className="cb-mb-side"><span className="cb-mb-label">At Bat</span><span className="cb-mb-num">#{game.current_batter_number}</span><span className="cb-mb-name">{game.current_batter_name}</span></div>}
              {game.current_pitcher_name && <div className="cb-mb-side"><span className="cb-mb-label">Pitching</span><span className="cb-mb-num">#{game.current_pitcher_number}</span><span className="cb-mb-name">{game.current_pitcher_name}</span></div>}
            </div>
          )}
          <div className="cb-situation">
            <div className="cb-sit-item"><span className="cb-sit-lbl">Count</span><span className="cb-sit-val">{game.balls ?? 0}-{game.strikes ?? 0}</span></div>
            <div className="cb-sit-item"><span className="cb-sit-lbl">Outs</span><span className="cb-sit-val">{game.outs ?? 0}</span></div>
            <div className="cb-sit-item">
              <div className="cb-diamond">
                <div className={`cb-base second ${game.runner_second ? "on" : ""}`} />
                <div className={`cb-base third ${game.runner_third ? "on" : ""}`} />
                <div className={`cb-base first ${game.runner_first ? "on" : ""}`} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Linescore */}
      {linescores.length > 0 && (
        <div className="cb-ls-table">
          <table>
            <thead><tr><th className="cb-ls-team-col"></th>{innings.map(i => <th key={i}>{i}</th>)}<th className="cb-ls-rhe">R</th><th className="cb-ls-rhe">H</th><th className="cb-ls-rhe">E</th></tr></thead>
            <tbody>
              {teamOrder.map(tid => {
                const t = teams[tid] || {};
                const data = lsByTeam[tid] || {};
                const isHome = tid === game.home_team_id;
                return (
                  <tr key={tid}>
                    <td className="cb-ls-team-name">
                      {lg(t) && <img src={lg(t)} style={{ width: 18, height: 18, objectFit: "contain", verticalAlign: "middle", marginRight: 6 }} alt="" />}
                      {a(t)}
                    </td>
                    {innings.map(i => <td key={i} className={`cb-ls-inn ${(data[i] || 0) > 0 ? "runs" : ""}`}>{data[i] != null ? data[i] : "-"}</td>)}
                    <td className="cb-ls-rhe-val">{isHome ? (game.home_score ?? "-") : (game.away_score ?? "-")}</td>
                    <td className="cb-ls-rhe-val">{isHome ? (game.home_hits ?? "-") : (game.away_hits ?? "-")}</td>
                    <td className="cb-ls-rhe-val">{isHome ? (game.home_errors ?? "-") : (game.away_errors ?? "-")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabs */}
      <div className="cb-tabs">
        <button className={tab === "box" ? "active" : ""} onClick={() => setTab("box")}>Box Score</button>
        <button className={tab === "pitching" ? "active" : ""} onClick={() => setTab("pitching")}>Pitching</button>
        <button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>Game Info</button>
      </div>

      {/* Box Score */}
      {tab === "box" && teamOrder.map(tid => {
        const t = teams[tid] || {};
        const players = battingByTeam[tid] || [];
        if (!players.length) return null;
        const tot = totals(players, ["ab", "runs", "hits", "rbi", "bb", "so", "hr"]);
        return (
          <div className="cb-box-section" key={`bat-${tid}`}>
            <div className="cb-box-hdr">
              {lg(t) && <img src={lg(t)} style={{ width: 20, height: 20, objectFit: "contain" }} alt="" />}
              {f(t)} - Batting
              <span className="cb-box-tag">{tid === game.home_team_id ? "Home" : "Away"}</span>
            </div>
            <div className="table-scroll">
              <table className="cb-box-table">
                <thead><tr><th className="cb-bt-player">Batter</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th><th>HR</th><th>2B</th><th>3B</th><th>SB</th><th>PO</th><th>A</th><th>E</th></tr></thead>
                <tbody>
                  {players.map((p: any) => (
                    <tr key={p.id}>
                      <td className="cb-bt-player-cell"><span className="cb-jersey">{p.jersey_number}</span><span className="cb-pname">{p.player_name}</span></td>
                      <td>{p.ab ?? 0}</td><td className={p.runs > 0 ? "cb-hl" : ""}>{p.runs ?? 0}</td><td className={p.hits > 0 ? "cb-hl" : ""}>{p.hits ?? 0}</td>
                      <td className={p.rbi > 0 ? "cb-hl" : ""}>{p.rbi ?? 0}</td><td>{p.bb ?? 0}</td><td>{p.so ?? 0}</td>
                      <td className={p.hr > 0 ? "cb-hl" : ""}>{p.hr ?? 0}</td><td>{p.doubles ?? 0}</td><td>{p.triples ?? 0}</td>
                      <td>{p.sb ?? 0}</td><td>{p.po ?? 0}</td><td>{p.assists ?? 0}</td><td className={(p.errors || 0) > 0 ? "cb-hl" : ""}>{p.errors ?? 0}</td>
                    </tr>
                  ))}
                  <tr className="cb-totals"><td className="cb-bt-player-cell"><strong>Totals</strong></td><td>{tot.ab}</td><td>{tot.runs}</td><td>{tot.hits}</td><td>{tot.rbi}</td><td>{tot.bb}</td><td>{tot.so}</td><td>{tot.hr}</td><td colSpan={6}></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {tab === "box" && batting.length === 0 && <div className="cb-no-data">No batting data available for this game</div>}

      {/* Pitching */}
      {tab === "pitching" && teamOrder.map(tid => {
        const t = teams[tid] || {};
        const pitchers = pitchingByTeam[tid] || [];
        if (!pitchers.length) return null;
        return (
          <div className="cb-box-section" key={`pit-${tid}`}>
            <div className="cb-box-hdr">
              {lg(t) && <img src={lg(t)} style={{ width: 20, height: 20, objectFit: "contain" }} alt="" />}
              {f(t)} - Pitching
              <span className="cb-box-tag">{tid === game.home_team_id ? "Home" : "Away"}</span>
            </div>
            <div className="table-scroll">
              <table className="cb-box-table">
                <thead><tr><th className="cb-bt-player">Pitcher</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>HR</th><th>PC</th><th>STR</th><th>ERA</th></tr></thead>
                <tbody>
                  {pitchers.map((p: any) => (
                    <tr key={p.id}>
                      <td className="cb-bt-player-cell"><span className="cb-jersey">{p.jersey_number}</span><span className="cb-pname">{p.player_name}</span></td>
                      <td>{p.ip || "-"}</td><td>{p.hits ?? 0}</td><td>{p.runs ?? 0}</td><td>{p.er ?? 0}</td><td>{p.bb ?? 0}</td>
                      <td className={(p.so || 0) >= 5 ? "cb-hl" : ""}>{p.so ?? 0}</td>
                      <td className={p.hr > 0 ? "cb-hl" : ""}>{p.hr ?? 0}</td>
                      <td>{p.pitches ?? "-"}</td><td>{p.strikes ?? "-"}</td><td>{p.season_era || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {tab === "pitching" && pitching.length === 0 && <div className="cb-no-data">No pitching data available for this game</div>}

      {/* Info */}
      {tab === "info" && (
        <div className="cb-box-section">
          <div className="cb-box-hdr">Game Information</div>
          <div style={{ padding: 16, fontSize: 13, lineHeight: 2 }}>
            <div><strong>Date:</strong> {game.game_date}</div>
            <div><strong>Time:</strong> {game.start_time_display || "-"}</div>
            <div><strong>Venue:</strong> {game.venue_name || "-"}{game.venue_city ? `, ${game.venue_city}` : ""}{game.venue_state ? `, ${game.venue_state}` : ""}</div>
            <div><strong>Broadcast:</strong> {game.broadcast || "-"}</div>
            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0" }} />
            <div><strong>ESPN ID:</strong> {game.espn_id || "-"}</div>
            <div><strong>SB Event ID:</strong> {game.sb_event_id || "-"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
