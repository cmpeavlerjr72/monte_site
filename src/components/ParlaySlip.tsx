// src/components/ParlaySlip.tsx
//
// The persistent parlay slip: per-leg marginals, the correlation-aware joint,
// fair odds, and a comparison against whatever the book is charging.
//
// The number that matters is the JOINT: seeds where every leg of a game hit,
// counted directly off the seed-aligned columns. The naive independent product
// is shown beside it precisely so the gap is visible — that gap IS the
// same-game correlation, and it is the whole reason this is worth building.
//
// Layout intent: the fair price is the hero, everything else supports it.
// Legs are chips (logo + market + marginal), each game is a labelled group so
// same-game correlation is visually obvious, and the maths that qualifies the
// hero number (naive, CI, edge) sits beneath it in a quieter register.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSeeds, priceParlay, americanFromProb, compareToBook, legTeams,
  THIN_SEED_THRESHOLD,
  type Leg, type SeedsJson, type Pricing,
} from "../lib/parlay";
import { getTeamLogo } from "../utils/teamLogo";
import type { Season } from "../lib/cfbData";
import { Skeleton } from "./Skeleton";

type Props = {
  legs: Leg[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Reports the drawer's rendered height so the page can reserve exactly that
   *  much space and never let the fixed sheet cover the last cards. */
  onHeight?: (h: number) => void;
  /** Leg id to briefly pulse — a fresh add, or the row a duplicate quick-add
   *  from Top Edges resolved to (see Scoreboard's addLegFromTopEdges). */
  flashLegId?: string | null;
};

const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 3 : 1)}%`;

/** 16px team badge; total legs pass both teams and get an overlapped pair. */
function TeamLogos({ teams }: { teams: string[] }) {
  const found = teams.map((t) => ({ t, src: getTeamLogo(t) })).filter((x) => x.src);
  if (!found.length) {
    return <span style={{ width: 18, flexShrink: 0 }} aria-hidden />;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, width: found.length > 1 ? 28 : 18 }}>
      {found.map((x, i) => (
        <img
          key={x.t + i}
          src={x.src}
          alt=""
          width={17}
          height={17}
          loading="lazy"
          style={{ objectFit: "contain", marginLeft: i ? -6 : 0, zIndex: found.length - i }}
        />
      ))}
    </span>
  );
}

export default function ParlaySlip({ legs, onRemove, onClear, onClose, onHeight, flashLegId }: Props) {
  const rootRef = useRef<HTMLElement | null>(null);

  // Measure rather than guess: the sheet is 420px wide on desktop and
  // full-width under 720px, so a hardcoded reserve would be wrong somewhere.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeight || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => onHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    onHeight(el.getBoundingClientRect().height);
    return () => { ro.disconnect(); onHeight(0); };
  }, [onHeight]);

  const [seedsBySlug, setSeedsBySlug] = useState<Map<string, SeedsJson>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [bookOdds, setBookOdds] = useState("");

  useEffect(() => {
    if (!legs.length) { setSeedsBySlug(new Map()); setLoadErrors([]); return; }

    const ac = new AbortController();
    let alive = true;
    setLoading(true);

    (async () => {
      const wanted = new Map<string, Leg>();
      for (const l of legs) if (!wanted.has(l.slug)) wanted.set(l.slug, l);

      const next = new Map<string, SeedsJson>();
      const errs: string[] = [];
      await Promise.all(
        [...wanted.values()].map(async (l) => {
          try {
            next.set(l.slug, await getSeeds(l.row, l.season as Season, ac.signal));
          } catch (e: any) {
            if (e?.name === "AbortError") return;
            errs.push(`${l.teamB} @ ${l.teamA}: ${e?.message ?? e}`);
          }
        })
      );
      if (!alive) return;
      setSeedsBySlug(next);
      setLoadErrors(errs);
      setLoading(false);
    })();

    return () => { alive = false; ac.abort(); };
  }, [legs]);

  const pricing: Pricing | null = useMemo(
    () => priceParlay(legs, seedsBySlug),
    [legs, seedsBySlug]
  );

  const book = useMemo(() => {
    if (!pricing || pricing.thin) return null;
    const a = Number(bookOdds);
    if (bookOdds.trim() === "" || !Number.isFinite(a)) return null;
    return compareToBook(pricing.jointP, a);
  }, [pricing, bookOdds]);

  return (
    <aside ref={rootRef} className="parlay-slip">
      {/* Header: a brand hairline gives the drawer a spine and separates it
          from the page behind it. */}
      <div className="parlay-slip__head">
        <span style={{ fontWeight: 800, color: "var(--brand-text)", letterSpacing: 0.2 }}>
          Parlay slip
        </span>
        <span className="parlay-chip" style={{ fontSize: 11 }}>
          {legs.length} leg{legs.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="ui-btn" onClick={onClear} disabled={!legs.length}
            style={{ padding: "4px 10px", fontSize: 12 }}>
            Clear
          </button>
          <button type="button" className="ui-btn" onClick={onClose}
            style={{ padding: "4px 10px", fontSize: 12 }}>
            Close
          </button>
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 12 }}>
        {!legs.length && (
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            Open a game card and use <b style={{ color: "var(--text)" }}>+ Add leg</b> to build a
            parlay. Legs from the same game are priced together, so their correlation is included.
          </div>
        )}

        {loading && !pricing && (
          <div style={{ display: "grid", gap: 10 }}>
            <Skeleton height={64} />
            <Skeleton height={96} />
          </div>
        )}

        {loadErrors.map((e, i) => (
          <div key={i} style={{ fontSize: 12, color: "var(--muted)" }}>{e}</div>
        ))}

        {/* Legs, grouped by game */}
        {pricing?.blocks.map((b) => (
          <section key={b.slug} className="parlay-group">
            <header className="parlay-group__head">
              <TeamLogos teams={[b.teamB, b.teamA]} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: 0.2 }}>
                {b.teamB} @ {b.teamA}
              </span>
              {b.legs.length > 1 && (
                <span className="parlay-chip" style={{ marginLeft: "auto", fontSize: 10 }}>
                  SGP {b.jointHits}/{b.n}
                </span>
              )}
            </header>

            {b.legs.map((lp) => (
              <div
                key={lp.leg.id}
                className={lp.leg.id === flashLegId ? "parlay-leg card-flash" : "parlay-leg"}
              >
                <TeamLogos teams={legTeams(lp.leg.spec, lp.leg.teamA, lp.leg.teamB)} />
                <span className="parlay-leg__text">{lp.leg.label}</span>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 12.5,
                    color: lp.error ? "var(--muted)" : "var(--text)",
                  }}
                >
                  {lp.error ? "n/a" : pct(lp.p ?? 0)}
                </span>
                <button type="button" className="parlay-leg__x" onClick={() => onRemove(lp.leg.id)}
                  aria-label={`Remove ${lp.leg.label}`}>
                  ×
                </button>
              </div>
            ))}

            {b.legs.length > 1 && (
              <div style={{ fontSize: 10.5, color: "var(--muted)", padding: "5px 8px 0" }}>
                same-game joint {pct(b.jointP)} — correlation priced in
              </div>
            )}
          </section>
        ))}

        {/* Price */}
        {pricing && (
          pricing.thin ? (
            // HONESTY GATE: below this many hits the point estimate is noise.
            <div className="parlay-notice">
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span aria-hidden style={{ fontSize: 13 }}>⚠</span>
                <b style={{ fontSize: 13 }}>Too thin to price</b>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
                Only <b style={{ color: "var(--text)" }}>{pricing.minBlockHits}</b> of{" "}
                {pricing.blocks[0]?.n ?? 0} seeds hit the thinnest game block (need ≥{" "}
                {THIN_SEED_THRESHOLD}). At this sim count the fair price would be noise, so it is
                not shown.
              </div>
            </div>
          ) : (
            <div className="parlay-total">
              <div className="parlay-hero">
                <div>
                  <div style={{ fontSize: 10, letterSpacing: 0.6, color: "var(--muted)", textTransform: "uppercase" }}>
                    Fair odds
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05, letterSpacing: -0.5 }}>
                    {americanFromProb(pricing.jointP)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, letterSpacing: 0.6, color: "var(--muted)", textTransform: "uppercase" }}>
                    Hit rate
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                    {pct(pricing.jointP)}
                  </div>
                </div>
              </div>

              <dl className="parlay-meta">
                <div>
                  <dt>If independent</dt>
                  <dd>{americanFromProb(pricing.naiveP)} <span style={{ color: "var(--muted)" }}>({pct(pricing.naiveP)})</span></dd>
                </div>
                <div>
                  <dt>95% CI</dt>
                  <dd>
                    {pct(pricing.ciLo)} – {pct(pricing.ciHi)}
                    <span style={{ color: "var(--muted)" }}>{pricing.ciApprox ? " approx" : ""}</span>
                  </dd>
                </div>
                <div>
                  <dt>Seeds hit</dt>
                  <dd>{pricing.minBlockHits}</dd>
                </div>
              </dl>

              {legs.length > 1 && (
                <div style={{ fontSize: 10.5, color: "var(--muted)", padding: "0 10px 8px" }}>
                  The gap between fair and “if independent” is the same-game correlation.
                </div>
              )}

              {/* Book comparison */}
              <div className="parlay-book">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Book odds</span>
                <input
                  type="text" inputMode="numeric" placeholder="+650"
                  value={bookOdds} onChange={(e) => setBookOdds(e.target.value)}
                  aria-label="Book odds, American"
                  style={{ width: 84 }}
                />
                {book && (
                  <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "baseline", fontSize: 12 }}>
                    <span style={{ color: "var(--muted)" }}>{pct(book.bookProb)}</span>
                    <b
                      className="parlay-edge"
                      data-sign={book.edge >= 0 ? "pos" : "neg"}
                    >
                      {book.edge > 0 ? "+" : ""}{(book.edge * 100).toFixed(1)} pts
                    </b>
                    <b
                      className="parlay-edge"
                      data-sign={book.evPerDollar >= 0 ? "pos" : "neg"}
                    >
                      {book.evPerDollar > 0 ? "+" : ""}{book.evPerDollar.toFixed(2)}/$1
                    </b>
                  </span>
                )}
              </div>
            </div>
          )
        )}

        {pricing && pricing.blocks.length > 1 && (
          <div style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.45 }}>
            Legs within a game are counted on the same simulated seeds, so their correlation is
            priced in. Different games are separate simulation runs and are multiplied as
            independent.
          </div>
        )}

        {pricing?.errors.map((e, i) => (
          <div key={i} style={{ fontSize: 11, color: "var(--muted)" }}>{e}</div>
        ))}
      </div>
    </aside>
  );
}
