import { PickRow } from "../pages/Results";

/**
 * Results already has the grading logic.
 * Here we just expose a helper that takes the final `rows`
 * and converts them into the "GradedRow" shape expected by Trends.
 */
export function buildGradedRows(resultsRows: PickRow[]) {
  return resultsRows.map(r => ({
    season: 2025,                       // or parse from week string
    week: r.weekNum,
    kickoff: r.kickoffMs
      ? new Date(r.kickoffMs).toISOString()
      : new Date().toISOString(),
    market: r.market === "ml" ? "moneyline" : r.market,
    pickType:
      r.market === "total"
        ? (r.isOverPick ? "over" : "under")
        : (r.isFavoritePick ? "favorite" : "underdog"),
    confidence: (r.confidence ?? 0) * 100,
    isPosEV: !!r.isPositiveEV,
    isConferenceGame:
      !!r.confA && !!r.confB && r.confA.toLowerCase() === r.confB.toLowerCase(),
    risk: r.stakeRisk ?? 1,
    units: r.units,
    odds_american: undefined,
    gameId: r.key,
    label: r.pickText,
  }));
}
