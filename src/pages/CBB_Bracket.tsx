import { useEffect, useMemo, useState } from "react";

/** CONFIG */

const DATASET_ROOT =
  "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main";
const SEASON = 2026;

// ---- NEW: snapshots (date + week) ----
type Snapshot = {
  id: string;
  label: string;
  week: string;
  date: string;
};

// Add more snapshots here as you publish new weeks.
// Last item in this array will be the default “latest”.
const SNAPSHOTS: Snapshot[] = [
  {
    id: "2026-01-03_W1",
    label: "Jan 3 – Week W1",
    week: "2026-W01",
    date: "2026-01-03",
  },
  {
    id: "2026-01-12_W3",
    label: "Jan 12 – Week W3",
    week: "2026-W03",
    date: "2026-01-12",
  },
    {
    id: "2026-01-20_W4",
    label: "Jan 20 – Week W4",
    week: "2026-W04",
    date: "2026-01-20",
  },
];

// --------------------------------------

const BRACKETOLOGISTS = [
  { id: "ESPN", label: "ESPN Bracketology - Joe Lunardi" },
  { id: "4and24", label: "4th and 24 - Patrick Winograd" },
  { id: "5Star", label: "5 Star Bets" },
  { id: "131", label: "1-3-1 Sports" },
  { id: "AAB", label: "AA Bracketology" },
  { id: "BBP", label: "Best Damn Bracket Period" },
  { id: "BDore", label: "BuckeyeDore" },
  { id: "BKS", label: "Bracksketblogs" },
  { id: "BR-KM", label: "Kerry Miller's Bracketology" },
  { id: "Brodd", label: "Bracket Odds" },
  { id: "BV-D", label: "Bracketville" },
  { id: "BV-T", label: "Bracketville - Tim Krueger" },
  { id: "Calm", label: "Calm Yourself Bracketology" },
  { id: "Cam", label: "Cam Nagle's Bracketology" },
  { id: "CD", label: "Cardinaldave's Bracketology" },
  { id: "CHB", label: "Charlie Hergenrother's Bracketology" },
  { id: "CPI", label: "The Coach and Crew Show" },
  { id: "CSM", label: "College Sports Madness" },
  { id: "CST", label: "Carolina Sports Thoughts" },
  { id: "DII", label: "D Ratings" },
  { id: "FOX", label: "FOX Sports - Mike DeCourcy" },
  { id: "Frank", label: "Franketology" },
  { id: "GDB", label: "Graham Doeren Bracketology" },
  { id: "HHD", label: "HoopsHD" },
  { id: "HM", label: "Haslametrics" },
  { id: "INCC", label: "INCC Stats" },
  { id: "Ivar", label: "Ivar's Blog" },
  { id: "JNG", label: "JNG Nitty Gritty Rankings" },
  { id: "JSB", label: "JS Bracketology" },
  { id: "MB", label: "Matt Browning's Bracketology" },
  { id: "MtM", label: "Making the Madness - Jonathon Warriner" },
  { id: "On3", label: "On3 Bracketology - James Fletcher III" },
  { id: "Pi", label: "The Pi-Rate Ratings" },
  { id: "Rev", label: "CBB Review" },
  { id: "RtH", label: "Running the Hardwood" },
  { id: "SS", label: "Somelofske Sports" },
  { id: "T3", label: "T3 Bracketology" },
  { id: "Teacher", label: "Teacher Bracket" },
  { id: "T-Rank", label: "T-Ranketology" },
  { id: "TRR", label: "The Round Robin" },
  { id: "Zac", label: "Bracket Zac" },
].sort((a, b) => a.label.localeCompare(b.label));

type TeamSlug = string;

type StageId = "R32" | "S16" | "E8" | "F4" | "NC" | "CHAMP";
type RoundId = "R64" | "R32" | "S16" | "E8" | "F4" | "NC";
type MatchId = string;

type Slot =
  | { kind: "seed"; seed: number }
  | { kind: "winner"; from: MatchId };

interface Match {
  id: MatchId;
  round: RoundId;
  regionIndex?: number;
  left: Slot;
  right: Slot;
  advanceTo?: StageId;
}

interface TeamMeta {
  slug: TeamSlug;
  name: string;
  kpName: string;
  logoPrimary?: string;
  logoAlt?: string;
}

interface RegionTeam {
  slug: TeamSlug;
  name: string;
  kpName: string;
  seed: number;
  conf: string;
  avgSeed: number;
  regionIndex: number;
  logo?: string;
}

interface MinimalRow {
  date: string;
  A_slug: string;
  B_slug: string;
  A_pts_med: number;
  B_pts_med: number;
  A_win: number;
  B_win: number;
}

interface BracketJsonTeamRow {
  seed: number;
  team: string;
  kp_name: string;
  team_slug: string;
  conf: string;
  avg_seed: number;
}

interface BracketJson {
  version: number;
  season: number;
  source: {
    name: string;
    bracketologist: string;
    url?: string;
    iso_week?: string;
  };
  teams: BracketJsonTeamRow[];
  meta: unknown;
}

type StageProbs = Partial<Record<StageId, number>>;
type PairMap = Record<string, MinimalRow>;
type SeedMap = Record<string, TeamSlug>;
type WinnersMap = Record<MatchId, Record<TeamSlug, number>>;
type PicksMap = Record<MatchId, TeamSlug | undefined>;

interface Projection {
  topMed: number;
  bottomMed: number;
  pTopWin: number;
  pBottomWin: number;
}

interface LayoutInfo {
  rowStart: number;
  rowSpan: number;
}

/** Helpers */

function americanOdds(p: number) {
  if (!isFinite(p) || p <= 0) return "∞";
  if (p >= 1) return "-∞";
  const x = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  const rounded = Math.round(x);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function pairKeySlug(a: string, b: string) {
  if (a === b) return `${a}__${b}`;
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function winProbSlug(a: TeamSlug, b: TeamSlug, pairMap: PairMap | null): number {
  if (!pairMap) return 0.5;
  if (a === b) return 0.5;
  const key = pairKeySlug(a, b);
  const row = pairMap[key];
  if (!row) return 0.5;
  if (row.A_slug === a) return row.A_win;
  if (row.B_slug === a) return row.B_win;
  return 0.5;
}

function projectionForPair(
  topSlug: TeamSlug | undefined,
  bottomSlug: TeamSlug | undefined,
  pairMap: PairMap | null
): Projection | null {
  if (!topSlug || !bottomSlug || !pairMap) return null;
  if (topSlug === bottomSlug) return null;
  const key = pairKeySlug(topSlug, bottomSlug);
  const row = pairMap[key];
  if (!row) return null;

  if (row.A_slug === topSlug) {
    return {
      topMed: row.A_pts_med,
      bottomMed: row.B_pts_med,
      pTopWin: row.A_win,
      pBottomWin: row.B_win,
    };
  }
  if (row.B_slug === topSlug) {
    return {
      topMed: row.B_pts_med,
      bottomMed: row.A_pts_med,
      pTopWin: row.B_win,
      pBottomWin: row.A_win,
    };
  }

  return {
    topMed: row.A_pts_med,
    bottomMed: row.B_pts_med,
    pTopWin: row.A_win,
    pBottomWin: row.B_win,
  };
}

/** Build bracket matches from regional teams */

function buildBracketMatches(regionTeams: RegionTeam[][]): {
  matches: Match[];
} {
  const matches: Match[] = [];
  const regionFinals: MatchId[] = [];

  const pairings: [number, number][] = [
    [1, 16],
    [8, 9],
    [5, 12],
    [4, 13],
    [6, 11],
    [3, 14],
    [7, 10],
    [2, 15],
  ];

  for (let r = 0; r < 4; r += 1) {
    const r64Ids: MatchId[] = [];

    pairings.forEach(([s1, s2], idx) => {
      const id: MatchId = `R64-R${r + 1}-G${idx + 1}`;
      matches.push({
        id,
        round: "R64",
        regionIndex: r,
        left: { kind: "seed", seed: s1 },
        right: { kind: "seed", seed: s2 },
        advanceTo: "R32",
      });
      r64Ids.push(id);
    });

    const r32Ids: MatchId[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id: MatchId = `R32-R${r + 1}-G${i + 1}`;
      matches.push({
        id,
        round: "R32",
        regionIndex: r,
        left: { kind: "winner", from: r64Ids[2 * i] },
        right: { kind: "winner", from: r64Ids[2 * i + 1] },
        advanceTo: "S16",
      });
      r32Ids.push(id);
    }

    const s16Ids: MatchId[] = [];
    for (let i = 0; i < 2; i += 1) {
      const id: MatchId = `S16-R${r + 1}-G${i + 1}`;
      matches.push({
        id,
        round: "S16",
        regionIndex: r,
        left: { kind: "winner", from: r32Ids[2 * i] },
        right: { kind: "winner", from: r32Ids[2 * i + 1] },
        advanceTo: "E8",
      });
      s16Ids.push(id);
    }

    const e8Id: MatchId = `E8-R${r + 1}-G1`;
    matches.push({
      id: e8Id,
      round: "E8",
      regionIndex: r,
      left: { kind: "winner", from: s16Ids[0] },
      right: { kind: "winner", from: s16Ids[1] },
      advanceTo: "F4",
    });
    regionFinals.push(e8Id);
  }

  const ffPairs: [number, number][] = [
    [0, 3],
    [1, 2],
  ];
  const ffIds: MatchId[] = [];

  ffPairs.forEach(([ra, rb], idx) => {
    const id: MatchId = `F4-G${idx + 1}`;
    matches.push({
      id,
      round: "F4",
      left: { kind: "winner", from: regionFinals[ra] },
      right: { kind: "winner", from: regionFinals[rb] },
      advanceTo: "NC",
    });
    ffIds.push(id);
  });

  const ncId: MatchId = "NC-1";
  matches.push({
    id: ncId,
    round: "NC",
    left: { kind: "winner", from: ffIds[0] },
    right: { kind: "winner", from: ffIds[1] },
    advanceTo: "CHAMP",
  });

  return { matches };
}

/** UI helpers */

function StageCell({ p }: { p: number | undefined }) {
  if (!p || p <= 0) return <span style={{ opacity: 0.4 }}>–</span>;
  const pct = (p * 100).toFixed(1) + "%";
  const odds = americanOdds(p);
  return (
    <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      {pct} ({odds})
    </span>
  );
}

type StageRankInfo = { rank: number; total: number };

function stageHeatColor(info?: StageRankInfo) {
  if (!info) return "transparent";
  const { rank, total } = info;
  if (total <= 1) return "transparent";

  const center = (total + 1) / 2;
  const diff = rank - center; // < 0 = better than middle
  const maxDiff = center - 1;
  if (maxDiff <= 0) return "transparent";

  const intensity = Math.min(1, Math.abs(diff) / maxDiff);

  // middle of pack ~white
  if (Math.abs(diff) < 0.5) return "transparent";

  const baseAlpha = 0.08;
  const extraAlpha = 0.3 * intensity;
  const alpha = baseAlpha + extraAlpha;

  if (diff < 0) {
    // better than average = greenish
    return `rgba(22, 163, 74, ${alpha})`;
  }
  // worse than average = reddish
  return `rgba(220, 38, 38, ${alpha})`;
}

function TeamRow({
  team,
  onClick,
  selected,
  projectedScore,
  placeholderLabel,
}: {
  team?: RegionTeam;
  onClick?: () => void;
  selected?: boolean;
  projectedScore?: number;
  placeholderLabel?: string;
}) {
  const isPlaceholder = !team;
  const scoreText =
    projectedScore === undefined || !isFinite(projectedScore)
      ? ""
      : String(Math.round(projectedScore));

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || isPlaceholder}
      style={{
        width: "100%",
        border: "none",
        background: selected ? "rgba(37, 99, 235, 0.12)" : "transparent",
        cursor: !onClick || isPlaceholder ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 6px",
        borderRadius: 8,
      }}
    >
      {team ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: 999,
                background: "rgba(15,23,42,0.06)",
              }}
            >
              {team.seed}
            </div>
            {team.logo ? (
              <img
                src={team.logo}
                alt={`${team.name} logo`}
                style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }}
                loading="lazy"
              />
            ) : null}
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {team.name}
            </div>
          </div>
          <div
            style={{
              fontVariantNumeric: "tabular-nums",
              fontSize: 12,
              opacity: scoreText ? 0.9 : 0.4,
            }}
          >
            {scoreText}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.5, fontStyle: "italic" }}>
          {placeholderLabel ?? "Waiting on teams…"}
        </div>
      )}
    </button>
  );
}

function MatchCard({
  match,
  topTeam,
  bottomTeam,
  pick,
  setPick,
  projection,
}: {
  match: Match;
  topTeam?: RegionTeam;
  bottomTeam?: RegionTeam;
  pick?: TeamSlug;
  setPick: (winner?: TeamSlug) => void;
  projection: Projection | null;
}) {
  const hasTeams = !!topTeam && !!bottomTeam;
  const topSelected = hasTeams && pick === topTeam?.slug;
  const bottomSelected = hasTeams && pick === bottomTeam?.slug;

  const topScore = projection ? projection.topMed : undefined;
  const bottomScore = projection ? projection.bottomMed : undefined;

  const topPlaceholderLabel =
    !topTeam && match.left.kind === "winner" ? `${match.left.from} Winner` : undefined;

  const bottomPlaceholderLabel =
    !bottomTeam && match.right.kind === "winner"
      ? `${match.right.from} Winner`
      : undefined;

  const line =
    projection && hasTeams
      ? `${topTeam?.name} ${(projection.pTopWin * 100).toFixed(1)}% • ${
          bottomTeam?.name
        } ${(projection.pBottomWin * 100).toFixed(1)}%`
      : !hasTeams
      ? "Waiting on teams…"
      : "No sims found";

  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(15,23,42,0.12)",
        padding: 6,
        background: "white",
        boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <TeamRow
          team={topTeam}
          projectedScore={topScore}
          selected={topSelected}
          onClick={hasTeams && topTeam ? () => setPick(topTeam.slug) : undefined}
          placeholderLabel={topPlaceholderLabel}
        />
        <TeamRow
          team={bottomTeam}
          projectedScore={bottomScore}
          selected={bottomSelected}
          onClick={hasTeams && bottomTeam ? () => setPick(bottomTeam.slug) : undefined}
          placeholderLabel={bottomPlaceholderLabel}
        />
      </div>

      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          opacity: 0.8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 10 }}>{match.id}</span>
        <span style={{ whiteSpace: "nowrap" }}>{line}</span>
      </div>
    </div>
  );
}

/** Main component */

export default function CBB_Bracket() {
  const [selectedBracket, setSelectedBracket] = useState<string>("ESPN");

  // NEW: snapshot state – default to last (latest) snapshot
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>(
    SNAPSHOTS[SNAPSHOTS.length - 1]?.id ?? SNAPSHOTS[0].id
  );
  const selectedSnapshot =
    SNAPSHOTS.find((s) => s.id === selectedSnapshotId) ?? SNAPSHOTS[0];

  const [teamsMaster, setTeamsMaster] = useState<
    Record<string, TeamMeta | undefined> | null
  >(null);
  const [pairMap, setPairMap] = useState<PairMap | null>(null);
  const [bracketJson, setBracketJson] = useState<BracketJson | null>(null);

  const [loadingCommon, setLoadingCommon] = useState<boolean>(true);
  const [loadingBracket, setLoadingBracket] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [picks, setPicks] = useState<PicksMap>({});

  // sort state for odds table
  const [sortColumn, setSortColumn] = useState<"SEED" | StageId>("CHAMP");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // mobile / desktop detection
  const [isMobile, setIsMobile] = useState(false);
  const [activeRegionMobile, setActiveRegionMobile] = useState<number>(0);
  const [activeRoundMobile, setActiveRoundMobile] = useState<RoundId>("R64");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 900);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // common data (teams_master + round_robin_minimal) – depends on snapshot
  useEffect(() => {
    let cancelled = false;

    async function loadCommon() {
      try {
        setLoadingCommon(true);
        setError(null);

        const { week, date } = selectedSnapshot;

        const base = `${DATASET_ROOT}/${SEASON}/bracketology/bracketmatrix/${week}/round_robin/${date}`;
        const teamsUrl = `${base}/teams_master.json`;
        const rrUrl = `${base}/${date}_round_robin_minimal.json`;

        const [teamsRes, rrRes] = await Promise.all([fetch(teamsUrl), fetch(rrUrl)]);
        if (!teamsRes.ok)
          throw new Error(`Failed to load teams_master.json (${teamsRes.status})`);
        if (!rrRes.ok)
          throw new Error(`Failed to load round_robin_minimal.json (${rrRes.status})`);

        const teamsJson = (await teamsRes.json()) as any[];
        const rrJson = (await rrRes.json()) as MinimalRow[];

        if (cancelled) return;

        const tmMap: Record<string, TeamMeta> = {};
        for (const row of teamsJson) {
          if (!row || !row.team_slug) continue;
          tmMap[row.team_slug] = {
            slug: row.team_slug,
            name: row.team ?? row.kp_name ?? row.team_slug,
            kpName: row.kp_name ?? row.team ?? row.team_slug,
            logoPrimary: row.logo_primary,
            logoAlt: row.logo_alt,
          };
        }

        const pMap: PairMap = {};
        for (const row of rrJson) {
          const key = pairKeySlug(row.A_slug, row.B_slug);
          pMap[key] = row;
        }

        setTeamsMaster(tmMap);
        setPairMap(pMap);
      } catch (err: any) {
        console.error(err);
        if (!cancelled) setError(err?.message ?? String(err));
      } finally {
        if (!cancelled) setLoadingCommon(false);
      }
    }

    loadCommon();
    return () => {
      cancelled = true;
    };
  }, [selectedSnapshotId, selectedSnapshot]);

  // bracket JSON – depends on bracketologist AND snapshot (week)
  useEffect(() => {
    let cancelled = false;
    async function loadBracket() {
      if (!selectedBracket) return;
      try {
        setLoadingBracket(true);
        setError(null);

        const { week } = selectedSnapshot;

        const url = `${DATASET_ROOT}/${SEASON}/bracketology/bracketmatrix/${week}/brackets/${selectedBracket}.json`;
        const res = await fetch(url);
        if (!res.ok)
          throw new Error(
            `Failed to load bracket JSON for ${selectedBracket} (${res.status})`
          );
        const json = (await res.json()) as BracketJson;
        if (cancelled) return;
        setBracketJson(json);
        setPicks({});
      } catch (err: any) {
        console.error(err);
        if (!cancelled) setError(err?.message ?? String(err));
      } finally {
        if (!cancelled) setLoadingBracket(false);
      }
    }
    loadBracket();
    return () => {
      cancelled = true;
    };
  }, [selectedBracket, selectedSnapshotId, selectedSnapshot]);

  const {
    regions,
    matches,
    seedMap,
    teamsBySlug,
    layoutByRegion,
  }: {
    regions: RegionTeam[][];
    matches: Match[];
    seedMap: SeedMap;
    teamsBySlug: Record<string, RegionTeam>;
    layoutByRegion: Record<number, Record<MatchId, LayoutInfo>>;
  } = useMemo(() => {
    if (!bracketJson || !teamsMaster) {
      return {
        regions: [],
        matches: [],
        seedMap: {},
        teamsBySlug: {},
        layoutByRegion: {},
      };
    }

    const bySeed = new Map<number, BracketJsonTeamRow[]>();
    for (const t of bracketJson.teams) {
      const arr = bySeed.get(t.seed) ?? [];
      arr.push(t);
      bySeed.set(t.seed, arr);
    }

    const regionTeams: RegionTeam[][] = [[], [], [], []];

    for (let seed = 1; seed <= 16; seed += 1) {
      const arr = (bySeed.get(seed) ?? []).slice().sort((a, b) => a.avg_seed - b.avg_seed);
      const keep = arr.slice(0, 4);
      for (let r = 0; r < keep.length && r < 4; r += 1) {
        const row = keep[r];
        const meta = teamsMaster[row.team_slug];
        regionTeams[r].push({
          slug: row.team_slug,
          name: meta?.name ?? row.team,
          kpName: meta?.kpName ?? row.kp_name ?? row.team,
          seed,
          conf: row.conf,
          avgSeed: row.avg_seed,
          regionIndex: r,
          logo: meta?.logoPrimary || meta?.logoAlt,
        });
      }
    }

    regionTeams.forEach((reg) => reg.sort((a, b) => a.seed - b.seed));

    const sMap: SeedMap = {};
    const tBySlug: Record<string, RegionTeam> = {};

    regionTeams.forEach((reg, rIdx) => {
      reg.forEach((t) => {
        sMap[`${rIdx}-${t.seed}`] = t.slug;
        tBySlug[t.slug] = t;
      });
    });

    const { matches } = buildBracketMatches(regionTeams);

    const layoutByRegion: Record<number, Record<MatchId, LayoutInfo>> = {};

    for (let r = 0; r < 4; r += 1) {
      const regionMatches = matches.filter((m) => m.regionIndex === r);
      const layout: Record<MatchId, LayoutInfo> = {};
      const leaves = regionMatches
        .filter((m) => m.round === "R64")
        .sort((a, b) => (a.id < b.id ? -1 : 1));

      leaves.forEach((m, idx) => {
        const rowSpan = 2;
        const rowStart = 2 + idx * 4;
        layout[m.id] = { rowStart, rowSpan };
      });

      const higherRounds: RoundId[] = ["R32", "S16", "E8"];
      higherRounds.forEach((round) => {
        const parents = regionMatches.filter((m) => m.round === round);
        parents.forEach((m) => {
          const leftFrom = m.left.kind === "winner" ? m.left.from : undefined;
          const rightFrom = m.right.kind === "winner" ? m.right.from : undefined;
          const leftInfo = leftFrom ? layout[leftFrom] : undefined;
          const rightInfo = rightFrom ? layout[rightFrom] : undefined;
          if (!leftInfo || !rightInfo) return;

          const childSpan = leftInfo.rowSpan;
          const rowSpan = childSpan * 2;
          const centerLeft = leftInfo.rowStart + childSpan / 2;
          const centerRight = rightInfo.rowStart + childSpan / 2;
          const center = (centerLeft + centerRight) / 2;
          const rowStart = Math.round(center - rowSpan / 2 + 1);

          layout[m.id] = { rowStart, rowSpan };
        });
      });

      layoutByRegion[r] = layout;
    }

    return {
      regions: regionTeams,
      matches,
      seedMap: sMap,
      teamsBySlug: tBySlug,
      layoutByRegion,
    };
  }, [bracketJson, teamsMaster]);

  const { stageProbs } = useMemo(() => {
    if (!matches.length || !pairMap) {
      return {
        stageProbs: {} as Record<TeamSlug, StageProbs>,
      };
    }

    const winners: WinnersMap = {};
    const reach: Record<TeamSlug, StageProbs> = {};

    const addReach = (team: TeamSlug, stage: StageId, p: number) => {
      if (!reach[team]) reach[team] = {};
      reach[team][stage] = (reach[team][stage] ?? 0) + p;
    };

    const getSlotDist = (m: Match, slot: Slot): Record<TeamSlug, number> => {
      if (slot.kind === "seed") {
        if (m.regionIndex == null) return {};
        const slug = seedMap[`${m.regionIndex}-${slot.seed}`];
        if (!slug) return {};
        return { [slug]: 1 };
      }
      return winners[slot.from] ?? {};
    };

    for (const m of matches) {
      const left = getSlotDist(m, m.left);
      const right = getSlotDist(m, m.right);

      const sumL = Object.values(left).reduce((s, v) => s + v, 0);
      const sumR = Object.values(right).reduce((s, v) => s + v, 0);
      if (sumL <= 0 || sumR <= 0) {
        winners[m.id] = {};
        continue;
      }

      Object.keys(left).forEach((k) => {
        left[k] = left[k] / sumL;
      });
      Object.keys(right).forEach((k) => {
        right[k] = right[k] / sumR;
      });

      const out: Record<TeamSlug, number> = {};
      const advanceTo = m.advanceTo;
      const picked = picks[m.id];

      const leftEntries = Object.entries(left) as [TeamSlug, number][];
      const rightEntries = Object.entries(right) as [TeamSlug, number][];

      for (const [a, pLeft] of leftEntries) {
        for (const [b, pRight] of rightEntries) {
          const pMeet = pLeft * pRight;
          if (pMeet <= 0) continue;

          let pAwin: number;
          let pBwin: number;

          if (picked === a) {
            pAwin = pMeet;
            pBwin = 0;
          } else if (picked === b) {
            pAwin = 0;
            pBwin = pMeet;
          } else {
            const pA = winProbSlug(a, b, pairMap);
            pAwin = pMeet * pA;
            pBwin = pMeet * (1 - pA);
          }

          if (pAwin > 0) {
            out[a] = (out[a] ?? 0) + pAwin;
            if (advanceTo) addReach(a, advanceTo, pAwin);
          }
          if (pBwin > 0) {
            out[b] = (out[b] ?? 0) + pBwin;
            if (advanceTo) addReach(b, advanceTo, pBwin);
          }
        }
      }

      const total = Object.values(out).reduce((s, v) => s + v, 0);
      if (total > 0) {
        Object.keys(out).forEach((k) => {
          out[k] = out[k] / total;
        });
      }

      winners[m.id] = out;
    }

    return { stageProbs: reach };
  }, [matches, pairMap, seedMap, picks]);

  // sorting helpers for odds table
  const handleSort = (col: "SEED" | StageId) => {
    setSortColumn((prevCol) => {
      if (prevCol === col) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevCol;
      }
      setSortDir(col === "SEED" ? "asc" : "desc");
      return col;
    });
  };

  const sortIndicator = (col: "SEED" | StageId) => {
    if (sortColumn !== col) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const { oddsRows, stageRanks } = useMemo(() => {
    const rows: { team: RegionTeam; stages: StageProbs }[] = [];

    const slugs = Object.keys(teamsBySlug);
    for (const slug of slugs) {
      const team = teamsBySlug[slug];
      const stages = stageProbs[slug] ?? {};
      rows.push({ team, stages });
    }

    const stageIds: StageId[] = ["R32", "S16", "E8", "F4", "NC", "CHAMP"];

    const ranks: Record<StageId, Record<TeamSlug, StageRankInfo>> = {
      R32: {},
      S16: {},
      E8: {},
      F4: {},
      NC: {},
      CHAMP: {},
    };

    stageIds.forEach((stage) => {
      const arr = rows
        .map((r) => ({ slug: r.team.slug, p: r.stages[stage] ?? 0 }))
        .sort((a, b) => b.p - a.p);

      const total = arr.length;
      arr.forEach((item, idx) => {
        ranks[stage][item.slug] = { rank: idx + 1, total };
      });
    });

    const sorted = [...rows].sort((a, b) => {
      if (sortColumn === "SEED") {
        const d = a.team.seed - b.team.seed;
        return sortDir === "asc" ? d : -d;
      } else {
        const pa = a.stages[sortColumn] ?? 0;
        const pb = b.stages[sortColumn] ?? 0;
        const d = pb - pa; // higher first
        return sortDir === "asc" ? -d : d;
      }
    });

    return { oddsRows: sorted, stageRanks: ranks };
  }, [teamsBySlug, stageProbs, sortColumn, sortDir]);

  const loading = loadingCommon || loadingBracket;

  const roundLabel: Record<RoundId, string> = {
    R64: "Round of 64",
    R32: "Round of 32",
    S16: "Sweet 16",
    E8: "Elite 8",
    F4: "Final Four",
    NC: "Title Game",
  };

  const renderMatch = (m: Match) => {
    const resolvedSlotTeam = (slot: Slot): RegionTeam | undefined => {
      if (slot.kind === "seed") {
        if (m.regionIndex == null) return undefined;
        const slug = seedMap[`${m.regionIndex}-${slot.seed}`];
        if (!slug) return undefined;
        return teamsBySlug[slug];
      }
      const winnerSlug = picks[slot.from];
      if (!winnerSlug) return undefined;
      return teamsBySlug[winnerSlug];
    };

    const topTeam = resolvedSlotTeam(m.left);
    const bottomTeam = resolvedSlotTeam(m.right);
    const projection = projectionForPair(topTeam?.slug, bottomTeam?.slug, pairMap);
    const pick = picks[m.id];

    const setPickForMatch = (winner?: TeamSlug) => {
      setPicks((prev) => {
        const next = { ...prev };
        if (!winner) delete next[m.id];
        else next[m.id] = winner;
        return next;
      });
    };

    return (
      <MatchCard
        key={m.id}
        match={m}
        topTeam={topTeam}
        bottomTeam={bottomTeam}
        pick={pick}
        setPick={setPickForMatch}
        projection={projection}
      />
    );
  };

  const regionNames = ["Region 1", "Region 2", "Region 3", "Region 4"];

  const outerStyles = {
    margin: "0 calc(-50vw + 50%)",
    padding: "16px 0",
  } as const;

  const innerStyles = {
    padding: "0 24px",
    boxSizing: "border-box" as const,
    width: "100vw",
  };

  /** Desktop bracket layout */
  const renderDesktopBracket = () => (
    <>
      {/* Regions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 32,
          alignItems: "flex-start",
          width: "100%",
        }}
      >
        {regions.map((_, regionIndex) => {
          const regionMatches = matches.filter((m) => m.regionIndex === regionIndex);
          const layout = layoutByRegion[regionIndex] ?? {};
          const byRound: Partial<Record<RoundId, Match[]>> = {};
          regionMatches.forEach((m) => {
            if (!byRound[m.round]) byRound[m.round] = [];
            byRound[m.round]!.push(m);
          });
          (Object.keys(byRound) as RoundId[]).forEach((r) => {
            byRound[r]!.sort((a, b) => (a.id < b.id ? -1 : 1));
          });

          const isRightSide = regionIndex % 2 === 1;
          const roundOrderLeft: RoundId[] = ["R64", "R32", "S16", "E8"];
          const roundOrderRight: RoundId[] = ["E8", "S16", "R32", "R64"];
          const columnRounds = isRightSide ? roundOrderRight : roundOrderLeft;

          const maxRow =
            Object.values(layout).reduce(
              (max, info) => Math.max(max, info.rowStart + info.rowSpan - 1),
              3
            ) + 1;

          const gridChildren: any[] = [];

          columnRounds.forEach((round, colIndex) => {
            // header
            gridChildren.push(
              <div
                key={`hdr-${regionIndex}-${round}`}
                style={{
                  gridColumn: colIndex + 1,
                  gridRow: 1,
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 4,
                }}
              >
                {roundLabel[round]}
              </div>
            );

            // games
            (byRound[round] ?? []).forEach((m) => {
              const info = layout[m.id];
              const gridRow = info ? `${info.rowStart} / span ${info.rowSpan}` : "auto";
              gridChildren.push(
                <div
                  key={m.id}
                  style={{
                    gridColumn: colIndex + 1,
                    gridRow,
                  }}
                >
                  {renderMatch(m)}
                </div>
              );
            });
          });

          return (
            <div key={regionIndex} style={{ width: "100%", overflowX: "auto" }}>
              <div
                style={{
                  fontWeight: 800,
                  marginBottom: 6,
                  fontSize: 15,
                }}
              >
                {regionNames[regionIndex]}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${columnRounds.length}, minmax(200px, 1fr))`,
                  gridTemplateRows: `repeat(${maxRow}, minmax(0, auto))`,
                  columnGap: 32,
                  rowGap: 8,
                  alignItems: "start",
                }}
              >
                {gridChildren}
              </div>
            </div>
          );
        })}
      </div>

      {/* Final Four & Title */}
      <div style={{ marginTop: 32 }}>
        <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 15 }}>
          Final Four & Title
        </div>
        <div
          style={{
            display: "grid",
            gridAutoFlow: "column",
            gridAutoColumns: "minmax(240px, 1fr)",
            gap: 16,
            overflowX: "auto",
          }}
        >
          {(["F4", "NC"] as RoundId[]).map((round) => {
            const roundMatches = matches
              .filter((m) => m.round === round)
              .sort((a, b) => (a.id < b.id ? -1 : 1));
            return (
              <div key={round} style={{ minWidth: 240 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 4,
                  }}
                >
                  {roundLabel[round]}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {roundMatches.map((m) => renderMatch(m))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  /** Mobile “stepper” bracket layout */
  const renderMobileBracket = () => {
    const regionTabs = [...regionNames, "Final Four"];
    const isFinals = activeRegionMobile === 4;
    const mobileRounds: RoundId[] = ["R64", "R32", "S16", "E8"];

    const renderRoundsForRegion = () => {
      const regionIndex = activeRegionMobile;
      const regionMatches = matches.filter((m) => m.regionIndex === regionIndex);
      const byRound: Partial<Record<RoundId, Match[]>> = {};
      regionMatches.forEach((m) => {
        if (!byRound[m.round]) byRound[m.round] = [];
        byRound[m.round]!.push(m);
      });
      mobileRounds.forEach((r) => {
        if (byRound[r]) byRound[r]!.sort((a, b) => (a.id < b.id ? -1 : 1));
      });

      const currentRoundMatches = (byRound[activeRoundMobile] ?? []).slice();

      return (
        <>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {mobileRounds.map((round) => {
              const active = activeRoundMobile === round;
              return (
                <button
                  key={round}
                  type="button"
                  onClick={() => setActiveRoundMobile(round)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: active
                      ? "1px solid rgba(37,99,235,0.8)"
                      : "1px solid rgba(148,163,184,0.7)",
                    background: active ? "rgba(37,99,235,0.08)" : "white",
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {roundLabel[round]}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {currentRoundMatches.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>No games for this round.</div>
            ) : (
              currentRoundMatches.map((m) => renderMatch(m))
            )}
          </div>
        </>
      );
    };

    const renderFinals = () => {
      const finalsRounds: RoundId[] = ["F4", "NC"];
      return (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
          {finalsRounds.map((round) => {
            const roundMatches = matches
              .filter((m) => m.round === round)
              .sort((a, b) => (a.id < b.id ? -1 : 1));
            if (!roundMatches.length) return null;
            return (
              <div key={round}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  {roundLabel[round]}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {roundMatches.map((m) => renderMatch(m))}
                </div>
              </div>
            );
          })}
        </div>
      );
    };

    return (
      <div>
        <div
          style={{
            display: "flex",
            overflowX: "auto",
            gap: 8,
            paddingBottom: 4,
          }}
        >
          {regionTabs.map((label, idx) => {
            const active = activeRegionMobile === idx;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setActiveRegionMobile(idx)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: active
                    ? "1px solid rgba(37,99,235,0.8)"
                    : "1px solid rgba(148,163,184,0.7)",
                  background: active ? "rgba(37,99,235,0.08)" : "white",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {!isFinals ? (
          <>
            <div
              style={{
                marginTop: 8,
                fontWeight: 800,
                fontSize: 15,
              }}
            >
              {regionNames[activeRegionMobile]}
            </div>
            {renderRoundsForRegion()}
          </>
        ) : (
          <>
            <div
              style={{
                marginTop: 8,
                fontWeight: 800,
                fontSize: 15,
              }}
            >
              Final Four & Title
            </div>
            {renderFinals()}
          </>
        )}
      </div>
    );
  };

  return (
    <div style={outerStyles}>
      <div style={innerStyles}>
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: 0.3 }}>
              CBB Bracketology Bracket
            </h1>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              Pairwise sims from {selectedSnapshot.date} &bull; Week{" "}
              {selectedSnapshot.week} &bull; Season {SEASON}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* NEW: snapshot selector */}
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Snapshot:
              <select
                value={selectedSnapshotId}
                onChange={(e) => setSelectedSnapshotId(e.target.value)}
                style={{
                  marginLeft: 8,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(15,23,42,0.2)",
                  fontSize: 13,
                }}
              >
                {SNAPSHOTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Bracketologist:
              <select
                value={selectedBracket}
                onChange={(e) => setSelectedBracket(e.target.value)}
                style={{
                  marginLeft: 8,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(15,23,42,0.2)",
                  fontSize: 13,
                }}
              >
                {BRACKETOLOGISTS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 8,
              background: "#fee2e2",
              color: "#991b1b",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        {loading ? (
          <div style={{ padding: 20, fontSize: 14 }}>Loading bracket & sims…</div>
        ) : !regions.length ? (
          <div style={{ padding: 20, fontSize: 14 }}>No bracket data loaded.</div>
        ) : (
          <>
            {isMobile ? renderMobileBracket() : renderDesktopBracket()}

            {/* Odds table */}
            <div style={{ marginTop: 32 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 15 }}>
                Path probabilities (from sims)
              </div>
              <div
                style={{
                  overflowX: "auto",
                  WebkitOverflowScrolling: "touch",
                  paddingBottom: 8,
                }}
              >
                <table
                  style={{
                    borderCollapse: "collapse",
                    fontSize: 12,
                    minWidth: 700,
                    width: "100%",
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        onClick={() => handleSort("SEED")}
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid rgba(0,0,0,0.1)",
                          position: "sticky",
                          left: 0,
                          background: "white",
                          zIndex: 1,
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}
                      >
                        Team{sortIndicator("SEED")}
                      </th>
                      {(["R32", "S16", "E8", "F4", "NC", "CHAMP"] as StageId[]).map((stage) => (
                        <th
                          key={stage}
                          onClick={() => handleSort(stage)}
                          style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderBottom: "1px solid rgba(0,0,0,0.1)",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                          }}
                        >
                          {stage === "R32"
                            ? "Reach 32"
                            : stage === "S16"
                            ? "Reach 16"
                            : stage === "E8"
                            ? "Reach 8"
                            : stage === "F4"
                            ? "Reach 4"
                            : stage === "NC"
                            ? "Reach title"
                            : "Win title"}
                          {sortIndicator(stage)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {oddsRows.map(({ team, stages }) => (
                      <tr key={team.slug}>
                        <td
                          style={{
                            padding: "4px 8px",
                            borderBottom: "1px solid rgba(0,0,0,0.04)",
                            position: "sticky",
                            left: 0,
                            background: "white",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 700,
                                fontVariantNumeric: "tabular-nums",
                                padding: "1px 6px",
                                borderRadius: 999,
                                background: "rgba(15,23,42,0.06)",
                                marginRight: 2,
                              }}
                            >
                              {team.seed}
                            </span>
                            {team.logo && (
                              <img
                                src={team.logo}
                                alt={`${team.name} logo`}
                                style={{
                                  width: 18,
                                  height: 18,
                                  objectFit: "contain",
                                  flexShrink: 0,
                                }}
                                loading="lazy"
                              />
                            )}
                            <span
                              style={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {team.name}
                            </span>
                          </div>
                        </td>
                        {(["R32", "S16", "E8", "F4", "NC", "CHAMP"] as StageId[]).map(
                          (stage) => {
                            const rankInfo = stageRanks[stage]?.[team.slug];
                            return (
                              <td
                                key={stage}
                                style={{
                                  padding: "4px 8px",
                                  borderBottom: "1px solid rgba(0,0,0,0.04)",
                                  backgroundColor: stageHeatColor(rankInfo),
                                }}
                              >
                                <StageCell p={stages[stage]} />
                              </td>
                            );
                          }
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
