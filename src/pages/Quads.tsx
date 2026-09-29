// /cfb/quads — college-football version of the NET quadrant résumé view.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getTeamLogo } from "../utils/teamLogo";
import {
  loadQuads, matchesConf, fmtWL, fmtSigned, fmtPct, fmtUpdatedET, otherVersions,
  QUAD_KEYS, VERSION_KEYS, SITE_WORD,
  type QuadsFile, type QuadsTeam, type QuadKey, type VersionKey,
} from "../lib/quadsData";
import "./Quads.css";

const QLABEL: Record<QuadKey, string> = { q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4", fcs: "FCS" };

function Chip({ q, on }: { q: QuadKey; on?: boolean }) {
  return <span className="quads__chip" data-q={q} data-on={on ? "true" : "false"}>{QLABEL[q]}</span>;
}

function TeamSheet({ t, v }: { t: QuadsTeam; v: VersionKey }) {
  const rem = t.remaining?.[v];
  return (
    <div className="quads__sheet">
      <div className="quads__scroll">
        <table className="quads__table">
          <thead>
            <tr>
              <th>Wk</th><th className="l">Opponent</th><th>Result</th><th>Bubble win</th>
              {VERSION_KEYS.map((k) => <th key={k}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {t.games.map((g, i) => (
              <tr key={i}>
                <td>{g.week}</td>
                <td className="l">
                  {SITE_WORD[g.site]} {g.opp}{" "}
                  <span className="quads__muted">{g.opp_sp_rank === null ? "FCS" : `SP+ ${g.opp_sp_rank}`}</span>
                </td>
                <td>{g.result ? `${g.result} ${g.score ?? ""}` : "upcoming"}</td>
                <td>{g.bubble_wp === null ? "–" : fmtPct(g.bubble_wp)}</td>
                {VERSION_KEYS.map((k) => (
                  <td key={k}><Chip q={g.quad[k]} on={k === v} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rem && (
        <p className="quads__muted" style={{ margin: "8px 0 0" }}>
          Remaining ({v}):{" "}
          {QUAD_KEYS.map((q) => `${QLABEL[q]} ${rem[q] ?? 0}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

export default function QuadsPage() {
  const [sp, setSp] = useSearchParams();
  const mock = sp.get("mock") === "1";
  const [data, setData] = useState<QuadsFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [conf, setConf] = useState("all");
  const [top25, setTop25] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const vParam = sp.get("v");
  const v: VersionKey = (VERSION_KEYS as string[]).includes(vParam ?? "") ? (vParam as VersionKey) : "D";

  useEffect(() => {
    const ac = new AbortController();
    setFailed(false);
    loadQuads(mock, ac.signal)
      .then(setData)
      .catch((e) => {
        if (!ac.signal.aborted) {
          console.warn(e);
          setFailed(true);
        }
      });
    return () => ac.abort();
  }, [mock]);

  const setV = (k: VersionKey) => {
    const next = new URLSearchParams(sp);
    next.set("v", k);
    setSp(next, { replace: true });
  };

  const conferences = useMemo(
    () => [...new Set((data?.teams ?? []).map((t) => t.conference))].sort(),
    [data],
  );
  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.teams].sort((a, b) => a.rank[v] - b.rank[v]);
    // Top 25 = national top 25 in this version; the conference filter applies on top.
    const base = top25 ? sorted.filter((t) => t.rank[v] <= 25) : sorted;
    return base.filter((t) => matchesConf(t, conf));
  }, [data, v, conf, top25]);
  const compare = useMemo(
    () => (data ? [...data.teams].sort((a, b) => a.rank.D - b.rank.D).slice(0, 25) : []),
    [data],
  );

  if (failed) {
    return (
      <div className="quads">
        <div className="card quads__card">
          <h2>Quads not published yet</h2>
          <p className="quads__muted" style={{ margin: 0 }}>
            The CFB Quads file for 2026 is not available yet. Check back after the next SP+ update.
          </p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="quads"><div className="card quads__card quads__muted">Loading quads…</div></div>;
  }

  const ver = data.versions.find((x) => x.key === v);
  const updated = fmtUpdatedET(data.generated_at);
  const cellWL = (t: QuadsTeam, q: QuadKey) => {
    const wl = t.quads[v]?.[q] ?? [0, 0];
    const bad = (q === "q3" || q === "q4" || q === "fcs") && wl[1] > 0;
    return (
      <td key={q} className={bad ? "quads__bad" : undefined}>
        <span className={q === "q1" && wl[0] > 0 ? "quads__best" : undefined}>{fmtWL(wl)}</span>
      </td>
    );
  };

  return (
    <div className="quads">
      <div className="card quads__card">
        <h2 style={{ fontSize: "1.3rem" }}>Quads</h2>
        <p style={{ margin: "0 0 6px" }}>
          Every game sorted by how hard it is for a playoff-bubble team: Quad 1 is the hardest, Quad 4 the easiest,
          and FCS opponents are kept separate.
        </p>
        <div className="quads__muted">
          Through week {data.through_week} · SP+ week {data.sp_week}{updated ? ` · updated ${updated}` : ""}
          {mock ? " · MOCK DATA" : ""}
        </div>
      </div>

      <div className="card quads__card">
        <div className="quads__seg" role="group" aria-label="Quad version">
          {data.versions.map((x) => (
            <button key={x.key} type="button" className="ui-btn"
              data-primary={x.key === v ? "true" : undefined}
              aria-pressed={x.key === v} onClick={() => setV(x.key)}>
              {x.short}
            </button>
          ))}
        </div>
        {ver && (
          <>
            <p style={{ margin: "10px 0 6px" }}><strong>{ver.name}.</strong> {ver.blurb}</p>
            <div className="quads__scroll">
              <table className="quads__table">
                <tbody>
                  {ver.rules.map((r, i) => (
                    <tr key={i}>
                      <td className="l"><strong>{r.label}</strong></td>
                      <td className="l" style={{ whiteSpace: "normal" }}>{r.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card quads__card">
        <div className="quads__filters">
          <select aria-label="Conference filter" value={conf} onChange={(e) => setConf(e.target.value)}>
            <option value="all">All conferences</option>
            <option value="p4">Power 4</option>
            <option value="g5">Group of 5</option>
            {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="ui-btn" aria-pressed={top25}
            data-primary={top25 ? "true" : undefined} onClick={() => setTop25(true)}>Top 25</button>
          <button type="button" className="ui-btn" aria-pressed={!top25}
            data-primary={!top25 ? "true" : undefined} onClick={() => setTop25(false)}>All</button>
        </div>
        <div className="quads__scroll">
          <table className="quads__table">
            <thead>
              <tr>
                <th>Rank</th><th className="l">Team</th><th>Rec</th>
                {QUAD_KEYS.map((q) => <th key={q}>{QLABEL[q]}</th>)}
                <th>WAB</th><th>SP+</th><th>Other versions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className="quads__muted">No teams match this filter.</td></tr>
              )}
              {rows.map((t) => {
                const isOpen = open === t.team;
                const logo = getTeamLogo(t.team);
                return (
                  <Fragment key={t.team}>
                    <tr className="quads__row" onClick={() => setOpen(isOpen ? null : t.team)}
                      aria-expanded={isOpen}>
                      <td><strong>{t.rank[v]}</strong></td>
                      <td className="l">
                        <div className="quads__team">
                          {logo ? <img src={logo} alt="" loading="lazy" /> : <span style={{ width: 22 }} />}
                          <span>{t.team}<span className="quads__conf">{t.conference}</span></span>
                        </div>
                      </td>
                      <td>{t.record}</td>
                      {QUAD_KEYS.map((q) => cellWL(t, q))}
                      <td>{fmtSigned(t.wab)}</td>
                      <td>{t.sp_rank}</td>
                      <td className="quads__muted">
                        {otherVersions(v).map((k) => `${k} ${t.rank[k]}`).join(" · ")}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={11} style={{ padding: 0 }}><TeamSheet t={t} v={v} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card quads__card">
        <h2>How the versions compare</h2>
        <p className="quads__muted" style={{ margin: "0 0 8px" }}>
          Top 25 by consensus (D). Highlighted cells differ from D by 3 or more spots.
        </p>
        <div className="quads__scroll">
          <table className="quads__table">
            <thead>
              <tr><th className="l">Team</th>{VERSION_KEYS.map((k) => <th key={k}>{k}</th>)}</tr>
            </thead>
            <tbody>
              {compare.map((t) => (
                <tr key={t.team}>
                  <td className="l">{t.team}</td>
                  {VERSION_KEYS.map((k) => (
                    <td key={k} className={k !== "D" && Math.abs(t.rank[k] - t.rank.D) >= 3 ? "quads__diff" : undefined}>
                      {t.rank[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.backtest && (
        <div className="card quads__card">
          <h2>Backtest vs the CFP committee</h2>
          <p className="quads__muted" style={{ margin: "0 0 8px" }}>Seasons {data.backtest.seasons}. {data.backtest.note}</p>
          <div className="quads__scroll">
            <table className="quads__table">
              <thead>
                <tr><th className="l">Method</th><th>Pairwise</th><th>Top-4 hit</th><th>Top-12 hit</th><th>Spearman (top 25)</th></tr>
              </thead>
              <tbody>
                {data.backtest.metrics.map((m, i) => (
                  <tr key={i}>
                    <td className="l">{m.label}</td>
                    <td>{fmtPct(m.pairwise)}</td>
                    <td>{fmtPct(m.top4)}</td>
                    <td>{fmtPct(m.top12)}</td>
                    <td>{m.spearman25.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
