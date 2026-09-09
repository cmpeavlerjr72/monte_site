// src/pages/Record.tsx
//
// THE 2026 RECORD — /cfb/record
//
// 2025's /cfb/results tracked one spread, one moneyline and one total per game
// and that page is untouched. 2026 publishes THOUSANDS of priced rungs a week
// across Kalshi team markets, game lines and (since week 1) DKeX player props,
// and the owner's brief was exactly this: a record people can browse "against
// the market in as many markets as possible" WITHOUT "the full board with
// every single bet listed — that would get out of hand".
//
// So the page is four selectors over a published ledger, and the shape is the
// house bar-test shape (verdict first, one number, words on tap):
//
//   1. THE VERDICT for the current selection — the fee-inclusive ROI at the
//      publish price as the hero, the W-L-P and the units underneath, this
//      week's number, and the running line across weeks.
//   2. THE CALIBRATION over the same selection — our probability of the shown
//      side in tens against what actually happened, on the diagonal, with n
//      printed per bucket and thin buckets drawn hollow and SAID to be thin.
//   3. THE ROWS, one per ladder, each opening its whole ladder on tap.
//
// Three rules the code enforces rather than hopes for:
//
//   • UNITS ARE COUNTED ONCE PER LADDER. Main line and Best EV each select one
//     row per ladder (`applyRung`), so 17+/21+/24+ for the same team is one
//     bet in the record, not three. "All rungs" shows every price and the page
//     PRINTS that those rows are correlated and n is games, not bets.
//   • THE FRAME IS NAMED ON SCREEN AND COMES FROM THE ROW. Kalshi rows are
//     struck "at publish"; DKeX props at "the early DKeX price" (the first
//     pre-kick trade captured in-week — those were never shown as picks).
//     `frameWords` / `frameSentence` in recordData.ts own every one of those
//     sentences; nothing here types a frame in by hand. A selection holding
//     BOTH venues names both AND shows the per-venue split beside the blended
//     headline, so one ROI over two frames is never the only number. DKeX
//     publishes no fee schedule, so its units carry a "pre-fee" mark.
//     The close sits on each row so the move is visible.
//   • PENDING IS NOT A RESULT. Unsettled rows render with a pending word and
//     are excluded from every number above them, and the page says how many.
//
// The math is `src/lib/recordData.ts` (presentation-free). This file draws.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { getTeamLogo } from "../utils/teamLogo";
import { cfbNameKey } from "../../server/cfbNames";
import { FBS_CONFERENCE } from "../lib/fbsConferences";
import {
  applyFilters, applyRung, baseMarket, betWords, calibration, calibrationMiss,
  cents, frameSentence, frameWords, isPreFee, ladderOf, loadRecord, marketWords,
  PERIOD_WORDS, periodOf, PREFEE_TIP, PRICE_BANDS, RecordNotPublished, signed,
  summarize, UNDERPOWERED, venuesOf, venueWords, weekLine,
  type CalibrationBucket, type EvMode, type RecordFilters, type RecordLoad,
  type RecordRow, type RungMode,
} from "../lib/recordData";

const SEASON = "2026";

/** Rows drawn before the first "show more", and per press after it. */
const PAGE = 50;

/** Chart mark hue. Its own token because it is a DATA mark, not the brand, not
 *  an edge sign and not an execution mode — the four channels stay disjoint.
 *  Both values were chosen by running the dataviz palette validator against
 *  each theme's card surface (light #2a78d6 on #ffffff, dark #4d97e6 on
 *  #161b22): lightness band, chroma floor and 3:1 contrast all pass. */
const MARK = "var(--rec-mark)";

const conferenceOf = (team: string): string =>
  FBS_CONFERENCE[cfbNameKey(team || "")] ?? "";

const fmtDate = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/* ------------------------------------------------------------------ logos */

function MatchupLogos({ home, away, size = 20 }: { home: string; away: string; size?: number }) {
  const a = getTeamLogo(away);
  const h = getTeamLogo(home);
  const label = `${away} at ${home}`;
  return (
    <span className="rec__logos" title={label} aria-label={label} role="img">
      {a ? <img src={a} alt="" width={size} height={size} /> : <span className="rec__noLogo">{away.slice(0, 3)}</span>}
      {h ? <img src={h} alt="" width={size} height={size} /> : <span className="rec__noLogo">{home.slice(0, 3)}</span>}
    </span>
  );
}

/* ----------------------------------------------------------- the verdict */

function Tile({ label, value, tone, note }: {
  label: string; value: string; tone?: string; note?: string;
}) {
  return (
    <div className="rec__tile" title={note}>
      <div className="rec__tileLabel">{label}</div>
      <div className="rec__tileValue" style={tone ? { color: tone } : undefined}>{value}</div>
      {note && <div className="rec__tileNote">{note}</div>}
    </div>
  );
}

/** A player row is about ONE school, so it badges that school rather than the
 *  matchup. Falls back to the matchup when the name does not resolve to a
 *  logo — a missing asset must not cost the row its context. */
function SubjectLogo({ team, subject, size = 20 }: {
  team: string; subject: string; size?: number;
}) {
  const src = getTeamLogo(team);
  if (!src) return null;
  const label = `${subject} · ${team}`;
  return (
    <span className="rec__logos" title={label} aria-label={label} role="img">
      <img src={src} alt="" width={size} height={size} />
    </span>
  );
}

const toneOf = (n: number): string =>
  n > 0 ? "var(--pos)" : n < 0 ? "var(--neg)" : "var(--muted)";

/* ------------------------------------------------- the calibration chart */

type CalPoint = CalibrationBucket & { hitPowered: number | null };

/** One bucket's dot. Powered buckets are filled in the mark hue; a bucket
 *  under 20 settled rows is HOLLOW — shape, not colour alone — and its n is
 *  printed under the axis beside it either way. */
function CalDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || payload?.hit == null) return null;
  const thin = payload.underpowered;
  return (
    <circle
      cx={cx} cy={cy} r={5}
      fill={thin ? "var(--card)" : MARK}
      stroke={thin ? "var(--muted)" : "var(--card)"}
      strokeWidth={2}
      opacity={thin ? 0.85 : 1}
    />
  );
}

/** Two-line tick: the bucket, and the n it rests on. */
function CalTick(props: any) {
  const { x, y, payload, buckets } = props;
  const b: CalPoint | undefined = buckets[Math.floor(payload.value / 10)];
  return (
    <g transform={`translate(${x},${y})`}>
      <text y={12} textAnchor="middle" fill="var(--muted)" fontSize={10}>
        {payload.value - 5}–{payload.value + 5}
      </text>
      <text y={25} textAnchor="middle" fontSize={10}
            fill={b && b.n && !b.underpowered ? "var(--text)" : "var(--muted)"}>
        {b ? `n=${b.n}` : "n=0"}
      </text>
    </g>
  );
}

function CalTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const b: CalPoint = payload[0].payload;
  if (!b?.n) return null;
  const miss = (b.hit ?? 0) - (b.said ?? 0);
  return (
    <div className="rec__tip">
      <div className="rec__tipHead">We said {b.lo}–{b.hi}%</div>
      <div>{b.n} settled · {b.wins}W {b.losses}L{b.pushes ? ` ${b.pushes}P` : ""}</div>
      <div>Our number {b.said?.toFixed(1)}% · we hit {b.hit?.toFixed(1)}%</div>
      <div style={{ color: toneOf(miss) }}>
        {Math.abs(miss) < 0.05 ? "on the diagonal" :
          `${Math.abs(miss).toFixed(1)} pts ${miss > 0 ? "above" : "below"} the diagonal`}
      </div>
      {b.underpowered && (
        <div className="rec__tipMuted">Under {UNDERPOWERED} rows — noise, not a finding.</div>
      )}
    </div>
  );
}

function Calibration({ rows, frame }: { rows: RecordRow[]; frame: string }) {
  const [numbers, setNumbers] = useState(false);
  const buckets = useMemo<CalPoint[]>(
    () => calibration(rows).map((b) => ({ ...b, hitPowered: b.underpowered ? null : b.hit })),
    [rows],
  );
  const settled = buckets.reduce((a, b) => a + b.n, 0);
  const miss = calibrationMiss(buckets);
  const powered = buckets.filter((b) => b.n && !b.underpowered).length;

  return (
    <section className="rec__panel">
      <div className="rec__panelHead">
        <div>
          <h2 className="rec__h2">Were we right as often as we said?</h2>
          <div className="rec__sub">
            {settled
              ? miss
                ? <>Across {settled.toLocaleString()} settled bets we hit{" "}
                    <strong style={{ color: toneOf(miss.miss) }}>
                      {signed(miss.miss, 1)} pts
                    </strong>{" "}
                    against our own number.</>
                : <>No settled bets in this selection yet.</>
              : <>Nothing has settled in this selection yet.</>}
          </div>
        </div>
        <button type="button" className="ui-btn rec__mini"
                onClick={() => setNumbers((v) => !v)} aria-expanded={numbers}>
          {numbers ? "Show chart" : "Show numbers"}
        </button>
      </div>

      {settled === 0 ? (
        <div className="rec__empty">
          A calibration chart needs settled bets. Come back after the slate.
        </div>
      ) : numbers ? (
        <div className="rec__scroll">
          <table className="rec__table">
            <thead>
              <tr>
                <th>We said</th><th>Our number</th><th>We hit</th><th>Miss</th><th>W-L-P</th><th>n</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.index} className={b.n && b.underpowered ? "rec__thin" : undefined}>
                  <td>{b.lo}–{b.hi}%</td>
                  <td>{b.said == null ? "—" : `${b.said.toFixed(1)}%`}</td>
                  <td>{b.hit == null ? "—" : `${b.hit.toFixed(1)}%`}</td>
                  <td style={b.hit != null && b.said != null ? { color: toneOf(b.hit - b.said) } : undefined}>
                    {b.hit != null && b.said != null ? `${signed(b.hit - b.said, 1)}` : "—"}
                  </td>
                  <td>{b.n ? `${b.wins}-${b.losses}-${b.pushes}` : "—"}</td>
                  <td>{b.n}{b.n && b.underpowered ? " (thin)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rec__caption">These bets are priced {frame}.</div>
        </div>
      ) : (
        <>
          <div className="rec__scroll">
            <div className="rec__chart">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={buckets} margin={{ top: 10, right: 14, bottom: 30, left: 2 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    type="number" dataKey="mid" domain={[0, 100]}
                    ticks={[5, 15, 25, 35, 45, 55, 65, 75, 85, 95]}
                    tick={<CalTick buckets={buckets} />}
                    tickLine={false} height={44}
                    axisLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v) => `${v}%`} width={38}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    tickLine={false} axisLine={false}
                  />
                  <ReferenceLine
                    segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]}
                    stroke="var(--muted)" strokeWidth={1} ifOverflow="visible"
                  />
                  <Tooltip content={<CalTip />} cursor={{ stroke: "var(--border)" }} />
                  <Line
                    type="linear" dataKey="hitPowered" stroke={MARK} strokeWidth={2}
                    dot={false} activeDot={false} connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear" dataKey="hit" stroke="none" dot={<CalDot />}
                    activeDot={false} isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rec__hint">Scroll the chart sideways to reach the higher buckets.</div>
          <div className="rec__caption">
            The straight line is perfect: a dot above it means we won more often
            than we said, below it means we said too much. {powered === 0
              ? <>No bucket has reached {UNDERPOWERED} settled bets yet, so every dot here is hollow — noise, not a finding.</>
              : <>Hollow dots are buckets under {UNDERPOWERED} settled bets: noise, not a finding, and the line skips them.</>}{" "}
            These bets are priced {frame}.
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------- the line across weeks */

function WeekTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rec__tip">
      <div className="rec__tipHead">Week {p.week}</div>
      <div>{p.scored} settled · {signed(p.units)}u that week</div>
      <div style={{ color: toneOf(p.cum) }}>{signed(p.cum)}u running</div>
    </div>
  );
}

function RunningLine({ rows, frame, fee }: { rows: RecordRow[]; frame: string; fee: string }) {
  const points = useMemo(() => weekLine(rows).filter((p) => p.scored > 0), [rows]);
  if (points.length === 0) return null;
  if (points.length === 1) {
    const p = points[0];
    return (
      <div className="rec__caption">
        Week {p.week} is the only settled week so far: {signed(p.units)} units on{" "}
        {p.scored} bets, {frame}. The running line starts once a second week settles.
      </div>
    );
  }
  return (
    <>
      <div className="rec__scroll">
        <div className="rec__chart rec__chart--short">
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={points} margin={{ top: 8, right: 14, bottom: 6, left: 2 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tickFormatter={(w) => `wk${w}`}
                     tick={{ fill: "var(--muted)", fontSize: 11 }}
                     tickLine={false} axisLine={{ stroke: "var(--border)" }} />
              <YAxis width={38} tick={{ fill: "var(--muted)", fontSize: 11 }}
                     tickLine={false} axisLine={false}
                     tickFormatter={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}u`} />
              <ReferenceLine y={0} stroke="var(--muted)" strokeWidth={1} />
              <Tooltip content={<WeekTip />} cursor={{ stroke: "var(--border)" }} />
              <Line type="linear" dataKey="cum" stroke={MARK} strokeWidth={2}
                    dot={{ r: 4, fill: MARK, stroke: "var(--card)", strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: MARK, stroke: "var(--card)", strokeWidth: 2 }}
                    isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rec__caption">
        Running units, 1 unit a bet, {fee}, {frame}:{" "}
        {points.map((p) => `wk${p.week} ${signed(p.units)}u`).join(" · ")}.
      </div>
    </>
  );
}

/* ------------------------------------------------------------- one row */

function LadderLine({ rung, shown }: { rung: RecordRow; shown: boolean }) {
  const move = rung.price_close != null ? rung.price_close - rung.price_publish : null;
  return (
    <div className={`rec__rung${shown ? " rec__rung--shown" : ""}`}>
      <span className="rec__rungLabel">
        {shown && <span className="rec__here" aria-hidden>▸</span>}
        {betWords(rung)}
      </span>
      <span className="rec__rungNums">
        <span title="Our simulated probability of this side">{(rung.pShown * 100).toFixed(0)}%</span>
        <span className="rec__dot" aria-hidden>·</span>
        <span title={`The price this rung is graded at — ${frameWords(rung)}`}>
          {cents(rung.price_publish)}
        </span>
        <span className="rec__dot" aria-hidden>·</span>
        <span title="The price at the close" className="rec__muted">
          close {cents(rung.price_close)}
          {move != null && Math.abs(move) >= 0.01
            ? ` (${move > 0 ? "+" : "−"}${Math.abs(Math.round(move * 100))})`
            : ""}
        </span>
      </span>
      <span className="rec__rungResult" style={rung.pnl_per_dollar != null ? { color: toneOf(rung.pnl_per_dollar) } : undefined}>
        {rung.result == null
          ? "pending"
          : rung.pnl_per_dollar == null
            ? rung.result
            : `${rung.result} ${signed(rung.pnl_per_dollar)}u`}
      </span>
    </div>
  );
}

function Row({ row, ladder, open, onToggle, showLadder }: {
  row: RecordRow;
  ladder: RecordRow[];
  open: boolean;
  onToggle: () => void;
  showLadder: boolean;
}) {
  const move = row.price_close != null ? row.price_close - row.price_publish : null;
  const player = row.family === "player";
  const preFee = isPreFee(row);
  const meta: string[] = [
    `we said ${(row.pShown * 100).toFixed(0)}%`,
    // The frame is the ROW's, never a constant: a DKeX prop was never posted
    // at a publish price and must not be described as if it were.
    `${cents(row.price_publish)} ${frameWords(row)}`,
  ];
  if (row.price_close != null) {
    meta.push(`close ${cents(row.price_close)}${
      move != null && Math.abs(move) >= 0.01
        ? ` (${move > 0 ? "+" : "−"}${Math.abs(Math.round(move * 100))})`
        : ""}`);
  }

  return (
    <div className={`rec__row${open ? " rec__row--open" : ""}`}>
      <button type="button" className="rec__main" onClick={onToggle}
              aria-expanded={showLadder ? open : undefined}
              title={showLadder ? "Tap to open the whole ladder" : `${row.away} at ${row.home}`}>
        <span className="rec__betLine">
          {player && row.subject_team && getTeamLogo(row.subject_team)
            ? <SubjectLogo team={row.subject_team} subject={row.subject ?? row.subject_team} />
            : <MatchupLogos home={row.home} away={row.away} />}
          <span className="rec__bet">{betWords(row)}</span>
          {row.starred && (
            <span className="rec__star"
                  title={row.published === false
                    ? "Would have been a ★ pick by the same rule; not shown on the site that week"
                    : "Published as a pick"}
                  aria-label={row.published === false ? "would have been a published pick" : "published pick"}>
              ★
            </span>
          )}
          {(row.ev_publish ?? -1) > 0 && !row.starred && (
            <span className="rec__chip"
                  title={preFee
                    ? `Positive edge ${frameWords(row)}, before any fee`
                    : `Positive fee-inclusive EV ${frameWords(row)}`}>+EV</span>
          )}
          {row.flags.map((f) => (
            <span key={f} className="rec__chip rec__chip--flag" title="Flagged by the publisher">{f}</span>
          ))}
        </span>
        <span className="rec__meta">
          <span className="rec__where">wk{row.week} · {marketWords(row.market)}</span>
          <span className="rec__dot" aria-hidden>·</span>
          {meta.join(" · ")}
        </span>
      </button>
      <span className="rec__edge">
        {row.result == null ? (
          <span className="rec__pending" title="Not settled — excluded from the numbers above">pending</span>
        ) : row.pnl_per_dollar == null ? (
          <span className="rec__result" title="Settled without a published fee-inclusive P&amp;L — not scored">
            {row.result}
          </span>
        ) : (
          <>
            <span className="rec__units" style={{ color: toneOf(row.pnl_per_dollar) }}
                  title={`${row.result} · 1 unit staked at ${cents(row.price_publish)} ${frameWords(row)}, ${preFee ? "before fees" : "fee-inclusive"}`}>
              {signed(row.pnl_per_dollar)}u
            </span>
            {preFee && (
              <span className="rec__prefee" title={PREFEE_TIP}>pre-fee</span>
            )}
          </>
        )}
      </span>

      {open && showLadder && (
        <div className="rec__ladder" role="region">
          <div className="rec__ladderHead">
            The whole ladder — {ladder.length} priced rung{ladder.length === 1 ? "" : "s"} on{" "}
            {row.subject ? `${row.subject} ` : ""}{marketWords(row.market).toLowerCase()},{" "}
            {row.away} at {row.home}. One opinion at several prices, so the record counts it once.
            {" "}Priced {frameWords(row)}.
          </div>
          {ladder.map((r) => <LadderLine key={r.id} rung={r} shown={r.id === row.id} />)}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- the page */

export default function Record() {
  const [load, setLoad] = useState<RecordLoad | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [err, setErr] = useState<string>("");
  const [help, setHelp] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [revealAll, setRevealAll] = useState(false);

  const [family, setFamily] = useState<RecordFilters["family"]>("all");
  const [market, setMarket] = useState("all");
  const [period, setPeriod] = useState("");
  const [ev, setEv] = useState<EvMode>("star");
  const [rung, setRung] = useState<RungMode>("best");
  const [week, setWeek] = useState<"all" | number>("all");
  const [team, setTeam] = useState("all");
  const [conference, setConference] = useState("all");
  const [band, setBand] = useState("10-90");
  const [q, setQ] = useState("");
  /** Once the reader picks a rung mode by hand it stops following the EV
   *  selector. Until then, +EV and ★ default to Best EV (owner's rule). */
  const rungTouched = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    setState("loading");
    loadRecord(SEASON, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        setLoad(r);
        setState(r.weeks.some((w) => w.rows.length) ? "ready" : "empty");
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (e instanceof RecordNotPublished) { setState("empty"); return; }
        setErr(e instanceof Error ? e.message : String(e));
        setState("error");
      });
    return () => ac.abort();
  }, []);

  const setEvMode = useCallback((mode: EvMode) => {
    setEv(mode);
    if (!rungTouched.current) setRung(mode === "all" ? "main" : "best");
  }, []);
  const setRungMode = useCallback((mode: RungMode) => {
    rungTouched.current = true;
    setRung(mode);
  }, []);

  const allRows = useMemo(
    () => (load ? load.weeks.flatMap((w) => w.rows) : []),
    [load],
  );

  /* Option lists come from the DATA, so a market the exporter adds next week
     appears in the selector without a code change. */
  const markets = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (family === "all" || r.family === family) set.add(baseMarket(r.market));
    return [...set].sort((a, b) => marketWords(a).localeCompare(marketWords(b)));
  }, [allRows, family]);

  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (family === "all" || r.family === family) set.add(periodOf(r.market));
    return [...set].sort();
  }, [allRows, family]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) { if (r.home) set.add(r.home); if (r.away) set.add(r.away); }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const conferences = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) { const c = conferenceOf(t); if (c) set.add(c); }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [teams]);

  const filters: RecordFilters = useMemo(
    () => ({ family, market, period, ev, rung, week, team, conference, band, q }),
    [family, market, period, ev, rung, week, team, conference, band, q],
  );

  const filtered = useMemo(
    () => applyFilters(allRows, filters, conferenceOf),
    [allRows, filters],
  );
  const selection = useMemo(() => applyRung(filtered, rung), [filtered, rung]);

  /* SETTLED FIRST. This is a record, so it leads with what happened: the
     newest graded week, then older ones, and the still-pending bets of the
     week in flight sit at the end where they cannot be mistaken for results
     (the first render of this page opened on a wall of "PENDING"). */
  const sorted = useMemo(
    () => [...selection].sort((a, b) =>
      ((a.result == null ? 1 : 0) - (b.result == null ? 1 : 0)) ||
      (b.week - a.week) ||
      String(a.kickoff_utc ?? "").localeCompare(String(b.kickoff_utc ?? "")) ||
      a.game_slug.localeCompare(b.game_slug) ||
      a.market.localeCompare(b.market) ||
      (b.price_publish - a.price_publish)),
    [selection],
  );

  const sum = useMemo(() => summarize(selection), [selection]);

  /* THE FRAME OF THIS SELECTION, and — when it holds two — the split.
     A blended ROI over a Kalshi publish price and a DKeX in-week trade is one
     number describing two frames, so the headline never stands alone. */
  const venues = useMemo(() => venuesOf(selection), [selection]);
  const frame = useMemo(() => frameSentence(venues), [venues]);
  const venueSplit = useMemo(
    () => (venues.length > 1
      ? venues.map((v) => ({
          venue: v,
          sum: summarize(selection.filter((r) => (r.venue ?? "kalshi") === v)),
        }))
      : []),
    [venues, selection],
  );

  /* The exporter's own fine print for a family in play, shown verbatim. */
  const familyNotes = useMemo(() => {
    const fams = new Set(selection.map((r) => r.family));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of load?.weeks ?? []) {
      for (const [fam, note] of Object.entries(w.families_note ?? {})) {
        if (!fams.has(fam as RecordRow["family"]) || !note || seen.has(note)) continue;
        seen.add(note);
        out.push(note);
      }
    }
    return out;
  }, [load, selection]);

  /* A venue with ONE traded price makes the better side +EV by construction,
     so "+EV only" is not a filter there — it is nearly the whole book. */
  const evDegenerate = ev === "pos" && venues.length === 1 && venues[0] === "dkex";

  /* Units are fee-inclusive except where the venue publishes no fee schedule,
     and the sentence has to say which of the three cases this selection is. */
  const preFee = useMemo(() => {
    const scored = selection.filter((r) => r.pnl_per_dollar != null);
    const n = scored.filter((r) => isPreFee(r)).length;
    return { any: n > 0, all: n > 0 && n === scored.length };
  }, [selection]);
  const feeWords = preFee.all
    ? "before fees"
    : preFee.any
      ? "fee-inclusive where the venue publishes a schedule"
      : "fee-inclusive";

  const thisWeek = useMemo(() => {
    const points = weekLine(selection).filter((p) => p.scored > 0);
    return points.length ? points[points.length - 1] : null;
  }, [selection]);

  /* Reset the paging whenever the selection changes, so a narrowed filter
     never leaves a "show more" count describing the previous slice. */
  const selectionKey = `${filtered.length}:${rung}:${sorted.length}`;
  const lastKey = useRef(selectionKey);
  if (lastKey.current !== selectionKey) {
    lastKey.current = selectionKey;
    if (shown !== PAGE) setShown(PAGE);
    if (revealAll) setRevealAll(false);
    if (open !== null) setOpen(null);
  }

  const allRungs = rung === "all";
  const visible = allRungs && !revealAll ? [] : sorted.slice(0, shown);

  const ladderFor = useCallback(
    (row: RecordRow) => ladderOf(allRows, row.ladder_id, row.week),
    [allRows],
  );

  const latestWeek = load?.index.length ? load.index[load.index.length - 1] : null;
  const pendingWeeks = (load?.index ?? []).filter((w) => !w.settled);

  if (state === "loading") {
    return <div className="rec"><div className="rec__empty">Loading the {SEASON} record…</div></div>;
  }
  if (state === "error") {
    return (
      <div className="rec">
        <div className="rec__empty">
          The {SEASON} record could not be loaded. {err}
        </div>
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="rec">
        <h1 className="rec__h1">{SEASON} record</h1>
        <div className="rec__empty">
          Nothing is published yet. The record appears once the first week is
          priced and graded.
        </div>
      </div>
    );
  }

  return (
    <div className="rec">
      <header className="rec__head">
        <div className="rec__headWords">
          <h1 className="rec__h1">{SEASON} record</h1>
          <div className="rec__sub">
            Every bet we priced against the market, graded{" "}
            <strong>{frame}</strong>
            {latestWeek?.publish_utc ? <> · through week {latestWeek.week}, published {fmtDate(latestWeek.publish_utc)}</> : null}
            {load?.weeks[0]?.engine_tag ? <> · engine {load.weeks[load.weeks.length - 1].engine_tag}</> : null}
          </div>
        </div>
        <button type="button" className="ui-btn icon rec__help"
                aria-expanded={help} aria-label="What these numbers mean"
                onClick={() => setHelp((v) => !v)}>?</button>
      </header>

      {help && (
        <div className="rec__defs" role="region" aria-label="Definitions">
          <p><strong>The price frame, and it is on every row.</strong> A Kalshi
            row is struck at the price when we published the bet — bets go in
            early in the week, so that is the number we are graded on. A DKeX
            player prop was never posted as a pick: it is struck at the first
            pre-kick price we captured in-week, and every row that says{" "}
            <em>at the early DKeX price</em> means exactly that. The close sits
            on every row so you can see how the market moved after.</p>
          <p><strong>One unit a bet, fee-inclusive.</strong> Every bet stakes
            one unit. A winner returns (1 − price) ÷ price units, less the
            exchange fee; a loser returns −1. ROI is net units ÷ bets settled,
            and the fee is always in it — <strong>except on DKeX</strong>, which
            publishes no fee schedule, so those units are marked{" "}
            <em>pre-fee</em>. A 2% fee would move that ROI about −2 points.</p>
          <p><strong>Units are counted once per ladder.</strong> "17+", "21+"
            and "24+" points for the same team are three prices on ONE opinion.
            Main line and Best EV each show one row per ladder, so the record
            counts it once. All rungs shows every price — those rows are
            correlated, and the n there is games, not independent bets.</p>
          <p><strong>Main line, Best EV.</strong> Main line is the rung priced
            nearest 50¢. Best EV is the rung with the highest edge in its own
            price frame, and it is the default whenever you filter to +EV or ★.</p>
          <p><strong>+EV and ★.</strong> +EV is any rung whose edge in its own
            frame was above zero — on DKeX, where one traded price prices both
            sides, that is true of the better side by construction, so it is
            barely a filter there. ★ is the smaller set the same rule picked as
            bets; on the week-1 props it marks what <em>would</em> have been a
            pick, since those were not shown on the site that week.</p>
          <p><strong>Thin buckets.</strong> A calibration bucket under{" "}
            {UNDERPOWERED} settled bets is drawn hollow and labelled: it is
            noise, not a finding.</p>
          <p><strong>Pending.</strong> A bet whose game has not settled shows
            as pending and is in none of the numbers above it.</p>
        </div>
      )}

      {/* ONE filter row above everything it scopes — every panel below reads
          the same slice. */}
      <div className="rec__filters">
        <label className="rec__f">
          <span>Family</span>
          <select className="ui-sel" value={family}
                  onChange={(e) => {
                    setFamily(e.target.value as RecordFilters["family"]);
                    setMarket("all");
                    // Back to the page default (Full game), not "all periods":
                    // player props carry no period prefix, so "" is the only
                    // period they have and it must stay selected for them.
                    setPeriod("");
                  }}>
            <option value="all">All</option>
            <option value="team">Team</option>
            <option value="game">Game</option>
            <option value="player">Player</option>
          </select>
        </label>
        <label className="rec__f">
          <span>Market</span>
          <select className="ui-sel" value={market} onChange={(e) => setMarket(e.target.value)}>
            <option value="all">All</option>
            {markets.map((m) => <option key={m} value={m}>{marketWords(m)}</option>)}
          </select>
        </label>
        {periods.length > 1 && (
          <label className="rec__f">
            <span>Period</span>
            <select className="ui-sel" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">All</option>
              {periods.map((p) => (
                <option key={p || "full"} value={p}>{PERIOD_WORDS[p] ?? p.toUpperCase()}</option>
              ))}
            </select>
          </label>
        )}
        <label className="rec__f">
          <span>Edge</span>
          <select className="ui-sel" value={ev} onChange={(e) => setEvMode(e.target.value as EvMode)}>
            <option value="all">All bets</option>
            <option value="pos">+EV only</option>
            <option value="star">★ picks</option>
          </select>
        </label>
        <label className="rec__f">
          <span>Rung</span>
          <select className="ui-sel" value={rung} onChange={(e) => setRungMode(e.target.value as RungMode)}>
            <option value="main">Main line</option>
            <option value="best">Best EV</option>
            <option value="all">All rungs</option>
          </select>
        </label>
        <label className="rec__f">
          <span>Week</span>
          <select className="ui-sel" value={String(week)}
                  onChange={(e) => setWeek(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All weeks</option>
            {(load?.index ?? []).map((w) => (
              <option key={w.week} value={w.week}>Week {w.week}</option>
            ))}
          </select>
        </label>
        <label className="rec__f">
          <span>Team</span>
          <select className="ui-sel" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="rec__f">
          <span>Conference</span>
          <select className="ui-sel" value={conference} onChange={(e) => setConference(e.target.value)}>
            <option value="all">All conferences</option>
            {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="rec__f">
          <span>Price</span>
          <select className="ui-sel" value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="all">Any price</option>
            {PRICE_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
        <label className="rec__f rec__f--wide">
          <span>Search</span>
          <input className="ui-sel" type="search" value={q} placeholder="team, market, strike…"
                 onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {/* The exporter's own fine print for a family in play, verbatim and
          muted, directly under the selectors that put it there. */}
      {familyNotes.map((note) => (
        <div key={note} className="rec__famNote">{note}</div>
      ))}

      {/* -------------------------------- THE VERDICT -------------------- */}
          <section className="rec__panel rec__verdict">
            <div className="rec__heroWrap">
              <div className="rec__heroLabel">
                {sum.scored ? "Return on every unit staked" : "Nothing settled in this selection"}
              </div>
              <div className="rec__hero" style={{ color: sum.roi == null ? "var(--muted)" : toneOf(sum.roi) }}>
                {sum.roi == null ? "—" : `${sum.roi > 0 ? "+" : sum.roi < 0 ? "−" : ""}${Math.abs(sum.roi * 100).toFixed(1)}%`}
              </div>
              <div className="rec__heroSub">
                {sum.scored
                  ? <><strong>{sum.wins}–{sum.losses}{sum.pushes ? `–${sum.pushes}` : ""}</strong>{" "}
                      · {signed(sum.units)} units on {sum.scored.toLocaleString()} bets at 1 unit each,
                      {" "}{feeWords}, {frame}</>
                  : <>No bet in this selection has settled yet.</>}
              </div>
            </div>

            {/* TWO FRAMES, TWO NUMBERS. The blended headline above is honest
                arithmetic but it is not one book: these tiles keep the reader
                from ever seeing it as the only number. */}
            {venueSplit.length > 1 && (
              <div className="rec__split">
                {venueSplit.map(({ venue, sum: s }) => (
                  <div key={venue} className="rec__splitTile">
                    <span className="rec__splitName">
                      {venueWords(venue)}
                      {venue === "dkex" ? " · early price" : " · at publish"}
                    </span>
                    <span className="rec__splitRoi"
                          style={{ color: s.roi == null ? "var(--muted)" : toneOf(s.roi) }}>
                      {s.roi == null
                        ? "—"
                        : `${s.roi > 0 ? "+" : s.roi < 0 ? "−" : ""}${Math.abs(s.roi * 100).toFixed(1)}%`}
                    </span>
                    <span className="rec__splitN">
                      {s.scored.toLocaleString()} settled · {signed(s.units)}u
                      {venue === "dkex" ? " · pre-fee" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="rec__tiles">
              <Tile label="Units" value={sum.scored ? `${signed(sum.units)}u` : "—"}
                    tone={sum.scored ? toneOf(sum.units) : undefined}
                    note={preFee.all
                      ? "1 unit a bet · DKeX, pre-fee"
                      : preFee.any
                        ? "1 unit a bet · DKeX rows pre-fee"
                        : "1 unit a bet, net of fees"} />
              <Tile label={thisWeek ? `Week ${thisWeek.week}` : "Latest week"}
                    value={thisWeek ? `${signed(thisWeek.units)}u` : "—"}
                    tone={thisWeek ? toneOf(thisWeek.units) : undefined}
                    note={thisWeek ? `${thisWeek.scored} settled` : "nothing settled"} />
              <Tile label={allRungs ? "Rungs shown" : "Ladders"}
                    value={(allRungs ? sum.n : sum.ladders).toLocaleString()}
                    note={allRungs ? "every priced rung" : "one bet each"} />
              <Tile label="Pending" value={sum.pending.toLocaleString()}
                    note="not in these numbers" />
            </div>

            <RunningLine rows={selection} frame={frame} fee={feeWords} />

            <div className="rec__notes">
              {evDegenerate && (
                <div className="rec__warn">
                  <strong>+EV is not much of a filter on DKeX.</strong> One traded
                  price prices both sides there, so whichever side our number
                  prefers is +EV by construction. Nothing is hidden — read this
                  selection as the whole book, not as a screened one. The ★ set
                  is the screened one.
                </div>
              )}
              {allRungs && (
                <div className="rec__warn">
                  All rungs is showing every priced rung. <strong>The rungs of one
                  ladder are correlated</strong> — they are the same opinion at
                  several prices — so treat n here as games, not independent bets.
                  Main line and Best EV count each ladder once.
                </div>
              )}
              {sum.pending > 0 && (
                <div>
                  {sum.pending.toLocaleString()} bet{sum.pending === 1 ? " is" : "s are"} still
                  pending{pendingWeeks.length
                    ? ` (week${pendingWeeks.length > 1 ? "s" : ""} ${pendingWeeks.map((w) => w.week).join(", ")} ${pendingWeeks.length > 1 ? "have" : "has"} not settled)`
                    : ""} and {sum.pending === 1 ? "is" : "are"} excluded from every number above.
                </div>
              )}
              {sum.unscored > 0 && (
                <div>
                  {sum.unscored.toLocaleString()} settled bet{sum.unscored === 1 ? "" : "s"} carried
                  no fee-inclusive P&amp;L in the published file, so {sum.unscored === 1 ? "it is" : "they are"}{" "}
                  in the W-L but not in the units or the ROI.
                </div>
              )}
              {(load?.skipped.length ?? 0) > 0 && (
                <div>
                  Week{load!.skipped.length > 1 ? "s" : ""} {load!.skipped.map((w) => w.week).join(", ")} {load!.skipped.length > 1 ? "were" : "was"} not
                  loaded (too many rows to hold at once) and {load!.skipped.length > 1 ? "are" : "is"} not in these numbers.
                </div>
              )}
            </div>
          </section>

          {/* ---------------------------- THE CALIBRATION -------------------- */}
          <Calibration rows={selection} frame={frame} />

          {/* --------------------------------- THE ROWS ---------------------- */}
          <section className="rec__panel">
            <div className="rec__panelHead">
              <div>
                <h2 className="rec__h2">
                  {allRungs ? "Every priced rung" : rung === "main" ? "One row a ladder — the main line" : "One row a ladder — the best price we had"}
                </h2>
                <div className="rec__sub">
                  {sorted.length.toLocaleString()} row{sorted.length === 1 ? "" : "s"} in this selection
                  {!allRungs && <> · tap a row to open its whole ladder</>}
                  {sum.pending > 0 && <> · settled first, pending at the end</>}
                </div>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="rec__empty">Nothing matches these filters.</div>
            ) : allRungs && !revealAll ? (
              <div className="rec__revealWrap">
                <button type="button" className="ui-btn" data-primary="true"
                        onClick={() => setRevealAll(true)}>
                  Show {sorted.length.toLocaleString()} rows
                </button>
                <div className="rec__caption">
                  Every rung of every ladder. It is a long list on purpose — the
                  numbers above already count each ladder once.
                </div>
              </div>
            ) : (
              <>
                <div className="rec__rows">
                  {visible.map((r) => (
                    <Row key={`${r.week}:${r.id}`} row={r}
                         ladder={open === `${r.week}:${r.id}` ? ladderFor(r) : []}
                         open={open === `${r.week}:${r.id}`}
                         showLadder={!allRungs}
                         onToggle={() => setOpen((cur) => (cur === `${r.week}:${r.id}` ? null : `${r.week}:${r.id}`))} />
                  ))}
                </div>
                {shown < sorted.length && (
                  <div className="rec__revealWrap">
                    <button type="button" className="ui-btn"
                            onClick={() => setShown((n) => n + PAGE)}>
                      Show {Math.min(PAGE, sorted.length - shown)} more
                      <span className="rec__muted"> · {(sorted.length - shown).toLocaleString()} left</span>
                    </button>
                  </div>
                )}
              </>
            )}
      </section>
    </div>
  );
}
