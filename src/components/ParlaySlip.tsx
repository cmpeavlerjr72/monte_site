// src/components/ParlaySlip.tsx
//
// The persistent parlay slip: per-leg marginals, the correlation-aware joint,
// fair odds, and a comparison against whatever the book is charging.
//
// The number that matters is the JOINT: seeds where every leg of a game hit,
// counted directly off the seed-aligned columns. The naive independent product
// is shown beside it precisely so the gap is visible — that gap IS the
// same-game correlation, and it is the whole reason this is worth building.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSeeds, priceParlay, americanFromProb, compareToBook,
  THIN_SEED_THRESHOLD,
  type Leg, type SeedsJson, type Pricing,
} from "../lib/parlay";
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
};

const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 3 : 1)}%`;

export default function ParlaySlip({ legs, onRemove, onClear, onClose, onHeight }: Props) {
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

  // Load seeds for every game the slip touches. getSeeds is memoized per game,
  // so re-running this on each slip change costs nothing after the first fetch.
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
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 800, color: "var(--brand-text)" }}>Parlay slip</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
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
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Open a game card and use <b>+ Add leg</b> to build a parlay. Legs from the
            same game are priced together, so their correlation is included.
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

        {/* legs, grouped by game */}
        {pricing?.blocks.map((b) => (
          <div key={b.slug} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              {b.teamB} @ {b.teamA}
            </div>
            {b.legs.map((lp) => (
              <div key={lp.leg.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {lp.leg.label}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: lp.error ? "var(--muted)" : "var(--text)" }}>
                  {lp.error ? "n/a" : pct(lp.p ?? 0)}
                </span>
                <button type="button" className="ui-btn" onClick={() => onRemove(lp.leg.id)}
                  aria-label={`Remove ${lp.leg.label}`}
                  style={{ padding: "1px 7px", fontSize: 12 }}>
                  ×
                </button>
              </div>
            ))}
            {b.legs.length > 1 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, paddingTop: 4, borderTop: "1px dashed var(--border)" }}>
                same-game joint: <b style={{ color: "var(--text)" }}>{b.jointHits}</b> / {b.n} seeds ({pct(b.jointP)})
              </div>
            )}
          </div>
        ))}

        {/* price */}
        {pricing && (
          pricing.thin ? (
            // HONESTY GATE: below this many hits the point estimate is noise.
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "color-mix(in oklab, var(--accent) 10%, transparent)" }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>Too thin to price</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Only <b style={{ color: "var(--text)" }}>{pricing.minBlockHits}</b> of{" "}
                {pricing.blocks[0]?.n ?? 0} seeds hit the thinnest game block
                (need ≥ {THIN_SEED_THRESHOLD}). At this sim count the fair price
                would be noise, so it is not shown.
              </div>
            </div>
          ) : (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Fair</span>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{americanFromProb(pricing.jointP)}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{pct(pricing.jointP)}</span>
              </div>

              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                if independent: <b style={{ color: "var(--text)" }}>{americanFromProb(pricing.naiveP)}</b>{" "}
                ({pct(pricing.naiveP)})
                {legs.length > 1 && (
                  <span> — the gap is the same-game correlation</span>
                )}
              </div>

              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                95% CI {pct(pricing.ciLo)} – {pct(pricing.ciHi)}
                {pricing.ciApprox ? " (approx, cross-game)" : " (Wilson)"}
                {" · "}{pricing.minBlockHits} hits
              </div>

              {/* book comparison */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 4, borderTop: "1px dashed var(--border)" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Book odds:</span>
                <input
                  type="text" inputMode="numeric" placeholder="+650"
                  value={bookOdds} onChange={(e) => setBookOdds(e.target.value)}
                  aria-label="Book odds, American"
                  style={{ width: 90 }}
                />
                {book && (
                  <span style={{ fontSize: 12 }}>
                    <span style={{ color: "var(--muted)" }}>implied </span>
                    {pct(book.bookProb)}
                    <span style={{ color: "var(--muted)" }}> · edge </span>
                    <b style={{ color: book.edge > 0 ? "var(--pos)" : "var(--neg)" }}>
                      {book.edge > 0 ? "+" : ""}{(book.edge * 100).toFixed(1)} pts
                    </b>
                    <span style={{ color: "var(--muted)" }}> · EV </span>
                    <b style={{ color: book.evPerDollar > 0 ? "var(--pos)" : "var(--neg)" }}>
                      {book.evPerDollar > 0 ? "+" : ""}{book.evPerDollar.toFixed(3)}/$1
                    </b>
                  </span>
                )}
              </div>
            </div>
          )
        )}

        {pricing && pricing.blocks.length > 1 && (
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Legs within a game are counted together on the same simulated seeds, so
            their correlation is priced in. Different games are separate simulation
            runs and are multiplied as independent.
          </div>
        )}

        {pricing?.errors.map((e, i) => (
          <div key={i} style={{ fontSize: 11, color: "var(--muted)" }}>{e}</div>
        ))}
      </div>
    </aside>
  );
}
