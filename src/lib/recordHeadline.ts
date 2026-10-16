// src/lib/recordHeadline.ts: the Record page's headline numbers, for the
// homepage tile (2026-10-16).
//
// LIVE FROM THE PUBLISHED LEDGER, never typed into the page: the same files
// (`2026/record_index.json` + every week's `record.json`), the same filters the
// Record page opens with (★ picks, Best EV rung, 10-90¢, 1 unit risked), the
// same `summarize`, so the tile and /cfb/record always show the same number.
//
// The ledger is ~400 KB gzip a week, so the load is memoised for the page
// session: the homepage tile and a later visit to /cfb/record share one fetch.
// A precomputed season summary from the publisher would make this one small
// file (noted in REVIEW.md as a follow-up).

import {
  applyFilters, applyRung, loadRecord, summarize, weekLine,
  type RecordFilters, type RecordLoad, type RecordSummary, type WeekPoint,
} from "./recordData";
import { FBS_CONFERENCE } from "./fbsConferences";
import { cfbNameKey } from "../../server/cfbNames";

export const RECORD_SEASON = "2026";

/** The Record page's opening selection. Keep in step with Record.tsx. */
export const DEFAULT_RECORD_FILTERS: RecordFilters = {
  family: "all", market: "all", period: "", ev: "star", rung: "best",
  week: "all", team: "all", conference: "all", band: "10-90", q: "",
};

let memo: Promise<RecordLoad> | null = null;

/** loadRecord(2026), once per page session. A failure clears the memo so a
 *  later mount can retry. */
export function loadRecordCached(): Promise<RecordLoad> {
  if (!memo) {
    memo = loadRecord(RECORD_SEASON).catch((e) => { memo = null; throw e; });
  }
  return memo;
}

export type RecordHeadline = {
  summary: RecordSummary;
  weeks: WeekPoint[];
  /** Highest week with at least one settled, scored row. */
  throughWeek: number | null;
  /** Latest week publish time, for "published Oct 10". */
  publishedUtc?: string;
};

export async function loadRecordHeadline(): Promise<RecordHeadline> {
  const load = await loadRecordCached();
  const rows = load.weeks.flatMap((w) => w.rows);
  const confOf = (team: string) => FBS_CONFERENCE[cfbNameKey(team || "")] ?? "";
  const selection = applyRung(applyFilters(rows, DEFAULT_RECORD_FILTERS, confOf), "best");
  const summary = summarize(selection, "risk");
  const weeks = weekLine(selection, "risk").filter((w) => w.scored > 0);
  const throughWeek = weeks.length ? weeks[weeks.length - 1].week : null;
  const last = load.weeks[load.weeks.length - 1];
  return { summary, weeks, throughWeek, publishedUtc: last?.publish_utc };
}
