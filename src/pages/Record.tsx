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
  CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { getTeamLogo } from "../utils/teamLogo";
import { cfbNameKey } from "../../server/cfbNames";
import { FBS_CONFERENCE } from "../lib/fbsConferences";
import {
  applyFilters, applyRung, baseMarket, betDays, betLine, betWords, calibration,
  calibrationMiss, cents, etDayStart, etDayTicks, frameSentence, frameWords,
  isPreFee, ladderOf, loadRecord, marketWords, PERIOD_WORDS, periodOf, PREFEE_TIP,
  PRICE_BANDS, RecordNotPublished, signed, STAKE_MODES, stakeOf, stakeWords,
  summarize, UNDERPOWERED, unitsOf, venuesOf, venueWords, weekLine,
  type BetPoint, type CalibrationBucket, type EvMode, type RecordFilters,
  type RecordLoad, type RecordRow, type RungMode, type UnitMode,
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

/* --------------------------------------- the line through the season */
/*
 * "A line graph showing units accumulated over time as the games progressed,
 * for all the bets in that filter" (owner, 2026-09-09). It REPLACES the
 * two-point week line that used to sit here — that line was this one sampled
 * once a week, and a week is not when a bet resolves.
 *
 * Three things it is built to get right:
 *
 *   • THE LINE ENDS WHERE THE HERO ENDS. `betLine` walks exactly the rows
 *     `summarize` counts into `units`, summing the same per-row numbers, so
 *     the last point IS the hero's figure. That is asserted at runtime, not
 *     trusted: a chart that disagrees with the number above it is worse than
 *     no chart. The endpoint is direct-labelled with it so a reader can check
 *     the same thing by eye.
 *   • X IS REAL TIME, IN ET. An idle midweek is a flat stretch and a Saturday
 *     is the near-vertical thing it actually is. Ticks are ET midnights, so
 *     the axis reads as a football calendar (weekday over date), and each
 *     week after the first is separated by a hairline.
 *   • THE STEP IS AFTER THE BET. `stepAfter` holds the running total from the
 *     bet that produced it until the next one resolves, which is what "units
 *     over time" means; a straight interpolation would draw units accruing
 *     during hours when nothing settled.
 *
 * Pending rows are not here at all — they are not results (the panel's own
 * sentence counts them), and a settled row with no published P&L is UNSCORED
 * and equally absent, exactly as it is from the hero.
 */

/** Dots stop earning their place once settlements sit closer together than a
 *  dot is wide — 237 bets across a 330px phone plot is 1.4px apart, which
 *  draws a smear rather than marks. Under this many, each dot is one bet you
 *  can actually aim at; over it, the line alone (the brief allows either up
 *  to 300, and this is where the density argument puts the switch). */
const DOTS_UPTO = 60;

const ET_ZONE = "America/New_York";
const etWeekday = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { timeZone: ET_ZONE, weekday: "short" });
const etDayMonth = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { timeZone: ET_ZONE, month: "numeric", day: "numeric" });
const etStamp = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    timeZone: ET_ZONE, weekday: "short", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

/** Units on an axis: signed, and never a false decimal. */
const axisUnits = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 10 || Number.isInteger(a) ? String(Math.round(a)) : a.toFixed(1);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}u`;
};

/** Weekday over date, two lines, so eight game days fit a phone. */
function DayTick({ x, y, payload }: any) {
  const ms = Number(payload?.value);
  if (!Number.isFinite(ms)) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} dy={12} textAnchor="middle" fill="var(--muted)" fontSize={10.5}>
        {etWeekday(ms)}
      </text>
      <text x={0} dy={24} textAnchor="middle" fill="var(--muted)" fontSize={10.5}>
        {etDayMonth(ms)}
      </text>
    </g>
  );
}

function BetTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as UnitPoint | undefined;
  // The origin sits at zero before the first bet and has nothing to say.
  if (!p?.row) return null;
  return (
    <div className="rec__tip">
      <div className="rec__tipHead">{betWords(p.row)}</div>
      <div style={{ color: toneOf(p.units) }}>{signed(p.units)}u on this bet</div>
      <div style={{ color: toneOf(p.cum) }}>{signed(p.cum)}u running</div>
      <div className="rec__tipMuted">
        {/* A stake that is not one unit has to say so, or the number above it
            reads as a 1u result. */}
        {Math.abs(p.stake - 1) > 0.005
          ? <>{p.stake.toFixed(2)}u staked at {cents(p.row.price_publish)} · </>
          : null}
        {etStamp(p.t)} ET{p.approxTime ? " (about — no settle time published)" : ""} · week {p.week}
      </div>
    </div>
  );
}

/** The chart's own datum: a bet, or the origin (zero, before the first one). */
type UnitPoint = Omit<BetPoint, "row"> & { row: RecordRow | null };

function RunningUnits({ rows, frame, fee, mode }: {
  rows: RecordRow[]; frame: string; fee: string; mode: UnitMode;
}) {
  const [numbers, setNumbers] = useState(false);
  const points = useMemo(() => betLine(rows, mode), [rows, mode]);
  const weeks = useMemo(() => weekLine(rows, mode).filter((p) => p.scored > 0), [rows, mode]);
  const days = useMemo(() => betDays(points), [points]);
  const heroUnits = useMemo(() => summarize(rows, mode).units, [rows, mode]);
  const end = points.length ? points[points.length - 1].cum : 0;

  /* THE ASSERTION. Same rows, same numbers, a different order of summing —
     if these two ever part, the page is lying somewhere and says so here. */
  useEffect(() => {
    if (points.length && Math.abs(end - heroUnits) > 1e-6) {
      console.warn(
        `[record] the running-units line ends at ${end.toFixed(4)}u but the hero sums ` +
        `${heroUnits.toFixed(4)}u over the same selection — they must agree.`,
      );
    }
  }, [points.length, end, heroUnits]);

  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const from = etDayStart(points[0].t);
    const to = points[points.length - 1].t;
    // Start the line at zero on the first game day, so the reader sees where
    // it began rather than a line that appears already ahead.
    const origin: UnitPoint = {
      t: from, cum: 0, units: 0, stake: 0, week: points[0].week,
      row: null, approxTime: false,
    };
    const allTicks = etDayTicks(from, to);
    // Thin evenly rather than letting two-line labels collide; recharts drops
    // any that are still too close (minTickGap) on top of this.
    const step = Math.max(1, Math.ceil(allTicks.length / 9));
    const bounds: { week: number; t: number }[] = [];
    const seen = new Set<number>();
    for (const p of points) {
      if (seen.has(p.week)) continue;
      seen.add(p.week);
      bounds.push({ week: p.week, t: etDayStart(p.t) });
    }
    // A week's name sits over the MIDDLE of its stretch, not on its boundary,
    // where it would collide with the hairline and with the day beneath it.
    const labels = bounds.map((b, i) => ({
      week: b.week,
      at: (b.t + (i + 1 < bounds.length ? bounds[i + 1].t : to)) / 2,
    }));
    return {
      data: [origin, ...points] as UnitPoint[],
      from, to, bounds, labels,
      ticks: allTicks.filter((_, i) => i % step === 0),
      last: points[points.length - 1],
    };
  }, [points]);

  if (points.length === 0) return null;
  if (!chart) {
    const only = points[0];
    return (
      <div className="rec__caption">
        One bet in this selection has settled so far — {betWords(only.row)},{" "}
        <strong style={{ color: toneOf(only.units) }}>{signed(only.units)}u</strong>, {fee},{" "}
        {frame}. The line starts once a second bet settles.
      </div>
    );
  }

  return (
    <div className="rec__run">
      <div className="rec__runHead">
        <div className="rec__runTitle">Running units, bet by bet</div>
        <button type="button" className="ui-btn rec__mini"
                onClick={() => setNumbers((v) => !v)} aria-expanded={numbers}>
          {numbers ? "Show chart" : "Show numbers"}
        </button>
      </div>

      {numbers ? (
        <div className="rec__scroll">
          <table className="rec__table">
            <thead>
              <tr><th>Game day</th><th>Bets</th><th>Units</th><th>Running</th></tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td>
                    {etWeekday(d.day)} {etDayMonth(d.day)}
                    <span className="rec__tipMuted"> · wk {d.weeks.join(", ")}</span>
                  </td>
                  <td>{d.n.toLocaleString()}</td>
                  <td style={{ color: toneOf(d.units) }}>{signed(d.units)}</td>
                  <td style={{ color: toneOf(d.cum) }}>{signed(d.cum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="rec__scroll">
            <div className="rec__chart rec__chart--units">
              <ResponsiveContainer width="100%" height={212}>
                {/* The right margin is the endpoint label's room: it has to
                    hold "−129.55u" without clipping at 390px. */}
                <LineChart data={chart.data} margin={{ top: 18, right: 62, bottom: 2, left: 2 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    type="number" dataKey="t" scale="time"
                    domain={[chart.from, chart.to]} ticks={chart.ticks}
                    tick={<DayTick />} interval="preserveStartEnd" minTickGap={10}
                    /* The formatter is what recharts MEASURES when it decides
                       which ticks fit (the custom tick above is what it draws).
                       Without it, it sizes a raw epoch — 13 digits — and drops
                       every day but the first and last on a phone. */
                    tickFormatter={etDayMonth}
                    tickLine={false} height={34}
                    axisLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    width={44} tick={{ fill: "var(--muted)", fontSize: 11 }}
                    tickLine={false} axisLine={false}
                    /* "auto" both ends so the ticks come out ROUND (pinning the
                       domain to the data hands you "+9.1u" and "−5.9u"); zero
                       is always inside it because the origin point is zero. */
                    domain={["auto", "auto"]}
                    tickFormatter={axisUnits}
                  />
                  {/* Week boundaries, lightly — the first one is the axis. */}
                  {chart.bounds.slice(1).map((b) => (
                    <ReferenceLine key={`b${b.week}`} x={b.t}
                                   stroke="var(--border)" strokeWidth={1} />
                  ))}
                  {chart.labels.length <= 8 && chart.labels.map((l) => (
                    <ReferenceLine key={`l${l.week}`} x={l.at} stroke="none"
                      label={{ value: `wk ${l.week}`, position: "top",
                               fill: "var(--muted)", fontSize: 10 }} />
                  ))}
                  <ReferenceLine y={0} stroke="var(--muted)" strokeWidth={1} />
                  <Tooltip content={<BetTip />} cursor={{ stroke: "var(--border)" }} />
                  <Line
                    type="stepAfter" dataKey="cum" stroke={MARK} strokeWidth={2}
                    dot={points.length <= DOTS_UPTO
                      ? { r: 2.5, fill: MARK, stroke: "none", fillOpacity: 0.55 }
                      : false}
                    activeDot={{ r: 5, fill: MARK, stroke: "var(--card)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                  {/* The one direct label: where the line ends is the hero. */}
                  <ReferenceDot
                    x={chart.last.t} y={chart.last.cum} r={3.5}
                    fill={MARK} stroke="var(--card)" strokeWidth={2}
                    label={{ value: `${signed(end)}u`, position: "right",
                             fill: toneOf(end), fontSize: 11.5, fontWeight: 800 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rec__hint">Drag across the chart to read each bet.</div>
        </>
      )}

      <div className="rec__caption">
        Running units, {stakeWords(mode)}, {fee}, {frame}:{" "}
        {weeks.map((p) => `wk${p.week} ${signed(p.units)}u`).join(" · ")}.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- one row */

function LadderLine({ rung, shown, mode }: {
  rung: RecordRow; shown: boolean; mode: UnitMode;
}) {
  const move = rung.price_close != null ? rung.price_close - rung.price_publish : null;
  const units = unitsOf(rung, mode);
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
      <span className="rec__rungResult" style={units != null ? { color: toneOf(units) } : undefined}>
        {rung.result == null
          ? "pending"
          : units == null
            ? rung.result
            : `${rung.result} ${signed(units)}u`}
      </span>
    </div>
  );
}

function Row({ row, ladder, open, onToggle, showLadder, mode }: {
  row: RecordRow;
  ladder: RecordRow[];
  open: boolean;
  onToggle: () => void;
  showLadder: boolean;
  mode: UnitMode;
}) {
  const move = row.price_close != null ? row.price_close - row.price_publish : null;
  const player = row.family === "player";
  const preFee = isPreFee(row);
  const units = unitsOf(row, mode);
  const staked = stakeOf(row, mode);
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
        ) : units == null ? (
          <span className="rec__result" title="Settled without a published fee-inclusive P&amp;L — not scored">
            {row.result}
          </span>
        ) : (
          <>
            <span className="rec__units" style={{ color: toneOf(units) }}
                  title={`${row.result} · ${staked.toFixed(2)} unit${staked === 1 ? "" : "s"} staked at ${cents(row.price_publish)} ${frameWords(row)}, ${preFee ? "before fees" : "fee-inclusive"}`}>
              {signed(units)}u
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
          {ladder.map((r) => (
            <LadderLine key={r.id} rung={r} shown={r.id === row.id} mode={mode} />
          ))}
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
  /* HOW A UNIT IS SPENT. Not a filter — it changes no row's presence, only the
     size of the bet behind every number on the page. Default `risk` is what
     the record has always shown. */
  const [stake, setStake] = useState<UnitMode>("risk");
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

  const sum = useMemo(() => summarize(selection, stake), [selection, stake]);

  /* THE FRAME OF THIS SELECTION, and — when it holds two — the split.
     A blended ROI over a Kalshi publish price and a DKeX in-week trade is one
     number describing two frames, so the headline never stands alone. */
  const venues = useMemo(() => venuesOf(selection), [selection]);
  const frame = useMemo(() => frameSentence(venues), [venues]);
  const venueSplit = useMemo(
    () => (venues.length > 1
      ? venues.map((v) => ({
          venue: v,
          sum: summarize(selection.filter((r) => (r.venue ?? "kalshi") === v), stake),
        }))
      : []),
    [venues, selection, stake],
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
    const points = weekLine(selection, stake).filter((p) => p.scored > 0);
    return points.length ? points[points.length - 1] : null;
  }, [selection, stake]);

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
          <p><strong>One unit a bet, fee-inclusive.</strong> By default every
            bet stakes one unit. A winner returns (1 − price) ÷ price units,
            less the exchange fee; a loser returns −1. ROI is net units ÷ units
            staked, and the fee is always in it — <strong>except on DKeX</strong>,
            which publishes no fee schedule, so those units are marked{" "}
            <em>pre-fee</em>. A 2% fee would move that ROI about −2 points.</p>
          <p><strong>Stake: risk, to win, or book.</strong> The same three the
            order console offers, and the selector re-sizes every number on
            this page — no row appears or disappears.{" "}
            <em>Risk</em> stakes one unit on every bet, whatever the price
            (the default, and what this record has always shown).{" "}
            <em>To win</em> stakes price ÷ (1 − price), so a winner pays one
            unit whether it was a 30¢ dog or an 85¢ favourite — the favourite
            simply risks more to do it (at 85¢, 5.7 units to win 1).{" "}
            <em>Book</em> is the sportsbook habit: a favourite (over 50¢,
            negative American odds) is sized to win a unit, a dog (50¢ and
            under) risks a unit — exactly how a −150 and a +150 offset on a
            slip. ROI stays units ÷ units staked in all three, so the modes are
            comparable; the units and the W-L are not the same number between
            them, and the sentence under the headline always says which is
            running.</p>
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
        {/* NOT a filter: it hides no row, it re-sizes every bet. Sits at the
            end of the row for that reason, and names the same three modes the
            order console offers. */}
        <label className="rec__f">
          <span>Stake</span>
          <select className="ui-sel" value={stake}
                  onChange={(e) => setStake(e.target.value as UnitMode)}>
            {STAKE_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
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
                      · {signed(sum.units)} units on {sum.scored.toLocaleString()} bets,{" "}
                      {stakeWords(stake)}
                      {stake === "risk" ? "" : ` (${sum.staked.toFixed(0)} units staked)`},
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
                    note={`${stake === "risk" ? "1 unit a bet" : `${sum.staked.toFixed(0)}u staked`}${
                      preFee.all
                        ? " · DKeX, pre-fee"
                        : preFee.any
                          ? " · DKeX rows pre-fee"
                          : ", net of fees"}`} />
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

            <RunningUnits rows={selection} frame={frame} fee={feeWords} mode={stake} />

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
                         showLadder={!allRungs} mode={stake}
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
