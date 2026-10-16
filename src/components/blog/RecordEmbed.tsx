// src/components/blog/RecordEmbed.tsx: `::record-card{frozen}` in a post.
// With `frozen="/blog/<slug>/rec.json"` ({label, record, units, roi, as_of})
// it shows numbers pinned at publish, which is what a post about a week should
// do; without it, the live 2026 headline (the same numbers as /cfb/record).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Stat, signedTone } from "../ui";
import { loadRecordHeadline } from "../../lib/recordHeadline";

type Rec = { label: string; record: string; units: number; roi: number | null; asOf: string | null; frozen: boolean };
const signed = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;

export function RecordEmbed({ frozen }: { frozen?: string }) {
  const [rec, setRec] = useState<Rec | null>(null);
  useEffect(() => {
    let alive = true;
    const p: Promise<Rec | null> = frozen
      ? fetch(frozen, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => j && ({
          label: j.label ?? "The record", record: j.record, units: j.units, roi: j.roi ?? null, asOf: j.as_of ?? null, frozen: true }))
      : loadRecordHeadline().then((h) => ({
          label: `2026 starred picks${h.throughWeek != null ? `, through week ${h.throughWeek}` : ""}`,
          record: `${h.summary.wins}-${h.summary.losses}`, units: h.summary.units, roi: h.summary.roi, asOf: null, frozen: false }));
    p.then((r) => { if (alive) setRec(r); }).catch(() => {});
    return () => { alive = false; };
  }, [frozen]);
  return (
    <aside className="simcard recembed">
      <div className="simcard__head">
        <span className="kicker">{rec?.label ?? "The record"}</span>
        <span className="simcard__asof">{rec?.frozen ? `Frozen${rec.asOf ? ` · ${rec.asOf}` : ""}` : "Live"}</span>
      </div>
      {rec ? (
        <div className="recembed__stats">
          <Stat size="lg" label="Record" value={rec.record} />
          <Stat size="lg" label="Units" value={`${signed(rec.units)}u`} tone={signedTone(rec.units)} />
          {rec.roi != null && <Stat size="lg" label="Per unit risked" value={`${signed(rec.roi * 100, 1)}%`} tone={signedTone(rec.roi)} />}
        </div>
      ) : <p className="simcard__asof">Loading the record…</p>}
      <div className="simcard__links"><Link className="simcard__link" to="/cfb/record">Every bet on the record page →</Link></div>
    </aside>
  );
}
