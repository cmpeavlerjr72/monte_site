// src/pages/site/RecordShell.tsx: season tabs over the record (2026-10-16).
//
//   /cfb/record        2026 (default): the published ledger (Record.tsx)
//   /cfb/record/2025   the 2025 archive: the old /cfb/results page, which
//                      grades one spread, ML and total per game (Results.tsx)
//
// /cfb/results redirects to the archive tab. The two seasons are graded on
// different contracts, so they stay two pages under one roof rather than one
// blended number. A precomputed 2025 summary from the publisher would make the
// archive load in one file instead of every week's bundle (REVIEW.md).

import type { ReactNode } from "react";
import { Tabs } from "../../components/ui";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

export default function RecordShell({ season, children }: { season: "2026" | "2025"; children: ReactNode }) {
  useDocumentMeta({
    title: season === "2026" ? "The 2026 record" : "2025 record (archive)",
    description: season === "2026"
      ? "Every pick graded at the price we posted it, fees included: return per unit, the running total, closing-line value and calibration."
      : "The 2025 season archive: every spread, moneyline and total pick, graded.",
  });
  return (
    <div className="stack" style={{ gap: "var(--sp-4)" }}>
      <Tabs label="Record season" items={[
        { id: "2026", label: "2026", to: "/cfb/record", end: true },
        { id: "2025", label: "2025 archive", to: "/cfb/record/2025" },
      ]} />
      {children}
    </div>
  );
}
