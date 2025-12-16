import React, { useMemo } from "react";

type TeamKey =
  | "James Madison"
  | "Oregon"
  | "Alabama"
  | "Oklahoma"
  | "Tulane"
  | "Ole Miss"
  | "Miami"
  | "Texas A&M"
  | "Texas Tech"
  | "Indiana"
  | "Georgia"
  | "Ohio State";

type TeamInfo = {
  name: TeamKey;
  seed: number;
  espnId: number; // used for logo
};

type MatchInfo = {
  id: string;
  round: "First Round" | "Quarterfinals" | "Semifinals" | "Championship";
  away?: TeamInfo | { placeholder: string };
  home?: TeamInfo | { placeholder: string };
  meta: string;
};

const TEAM: Record<TeamKey, TeamInfo> = {
  "James Madison": { name: "James Madison", seed: 12, espnId: 256 },
  Oregon: { name: "Oregon", seed: 5, espnId: 2483 },
  Alabama: { name: "Alabama", seed: 9, espnId: 333 },
  Oklahoma: { name: "Oklahoma", seed: 8, espnId: 201 },
  Tulane: { name: "Tulane", seed: 11, espnId: 2655 },
  "Ole Miss": { name: "Ole Miss", seed: 6, espnId: 145 },
  Miami: { name: "Miami", seed: 10, espnId: 2390 },
  "Texas A&M": { name: "Texas A&M", seed: 7, espnId: 245 },
  "Texas Tech": { name: "Texas Tech", seed: 4, espnId: 2641 },
  Indiana: { name: "Indiana", seed: 1, espnId: 84 },
  Georgia: { name: "Georgia", seed: 3, espnId: 61 },
  "Ohio State": { name: "Ohio State", seed: 2, espnId: 194 },
};

function logoUrl(espnId: number) {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
}

function SeedBadge({ seed }: { seed: number }) {
  return (
    <span
      style={{
        minWidth: 26,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: "rgba(0,0,0,0.06)",
        color: "var(--text)",
      }}
      title={`Seed ${seed}`}
    >
      {seed}
    </span>
  );
}

function TeamRow({
  team,
  align = "left",
}: {
  team: TeamInfo | { placeholder: string };
  align?: "left" | "right";
}) {
  const isPlaceholder = "placeholder" in team;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.9)",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      {!isPlaceholder ? (
        <>
          {align === "right" ? null : <SeedBadge seed={team.seed} />}
          <img
            src={logoUrl(team.espnId)}
            alt={`${team.name} logo`}
            style={{ width: 22, height: 22, objectFit: "contain" }}
            loading="lazy"
          />
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 170,
            }}
            title={team.name}
          >
            {team.name}
          </div>
          {align === "right" ? <SeedBadge seed={team.seed} /> : null}
        </>
      ) : (
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            opacity: 0.65,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 220,
          }}
          title={team.placeholder}
        >
          {team.placeholder}
        </div>
      )}
    </div>
  );
}

function MatchCard({ m, cardHeightPx }: { m: MatchInfo; cardHeightPx: number }) {
  return (
    <div
      style={{
        borderRadius: 14,
        background: "var(--card, #fff)",
        border: "1px solid rgba(0,0,0,0.10)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
        padding: 12,

        // ✅ IMPORTANT: fixed height so we can center later rounds precisely
        height: cardHeightPx,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "grid", gap: 8 }}>
        {m.away ? <TeamRow team={m.away as any} /> : null}
        {m.home ? <TeamRow team={m.home as any} /> : null}
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          opacity: 0.75,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={{ fontWeight: 700 }}>{m.round}</span>
        <span style={{ textAlign: "right" }}>{m.meta}</span>
      </div>
    </div>
  );
}

export default function Bracket() {
  // Tunables — you can tweak these two numbers to tighten/loosen spacing
  const CARD_H = 176; // fixed card height (px)
  const GAP = 14;     // vertical spacing between cards inside a column (px)

  // Offsets to center rounds between the feeders:
  // SF-1 centered between QF-1 and QF-2, SF-2 centered between QF-3 and QF-4
  const SEMI_PAD_TOP = (CARD_H + GAP) / 2;
  // The gap between SF-1 and SF-2 should equal 2*(CARD_H+GAP) - CARD_H = CARD_H + 2*GAP
  const SEMI_GAP = CARD_H + 2 * GAP;
  // Championship centered between SF-1 and SF-2
  const CHAMP_PAD_TOP = 1.5 * (CARD_H + GAP);

  const rounds = useMemo(() => {
    const firstRound: MatchInfo[] = [
      {
        id: "FR-1",
        round: "First Round",
        away: TEAM["James Madison"],
        home: TEAM["Oregon"],
        meta: "Dec 20 • 7:30 PM ET • Autzen Stadium",
      },
      {
        id: "FR-2",
        round: "First Round",
        away: TEAM["Alabama"],
        home: TEAM["Oklahoma"],
        meta: "Dec 19 • 8:00 PM ET • Memorial Stadium (Norman)",
      },
      {
        id: "FR-3",
        round: "First Round",
        away: TEAM["Tulane"],
        home: TEAM["Ole Miss"],
        meta: "Dec 20 • 3:30 PM ET • Oxford, MS",
      },
      {
        id: "FR-4",
        round: "First Round",
        away: TEAM["Miami"],
        home: TEAM["Texas A&M"],
        meta: "Dec 20 • Noon ET • Kyle Field",
      },
    ];

    const quarterfinals: MatchInfo[] = [
      {
        id: "QF-1",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-1" },
        home: TEAM["Texas Tech"],
        meta: "Jan 1 • Noon ET • Orange Bowl",
      },
      {
        id: "QF-2",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-2" },
        home: TEAM["Indiana"],
        meta: "Jan 1 • 4:00 PM ET • Rose Bowl",
      },
      {
        id: "QF-3",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-3" },
        home: TEAM["Georgia"],
        meta: "Jan 1 • 8:00 PM ET • Sugar Bowl",
      },
      {
        id: "QF-4",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-4" },
        home: TEAM["Ohio State"],
        meta: "Dec 31 • 7:30 PM ET • Cotton Bowl",
      },
    ];

    const semifinals: MatchInfo[] = [
      {
        id: "SF-1",
        round: "Semifinals",
        away: { placeholder: "Winner QF-1" },
        home: { placeholder: "Winner QF-2" },
        meta: "Jan 9 • 7:30 PM ET • Peach Bowl",
      },
      {
        id: "SF-2",
        round: "Semifinals",
        away: { placeholder: "Winner QF-3" },
        home: { placeholder: "Winner QF-4" },
        meta: "Jan 9 • 7:30 PM ET • Fiesta Bowl",
      },
    ];

    const championship: MatchInfo[] = [
      {
        id: "NC",
        round: "Championship",
        away: { placeholder: "Winner SF-1" },
        home: { placeholder: "Winner SF-2" },
        meta: "2026 National Championship • TBD",
      },
    ];

    return { firstRound, quarterfinals, semifinals, championship };
  }, []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: 0.2 }}>CFB Playoff Bracket</h1>
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
            2025–26 CFP • teams/logos + schedule
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(240px, 1fr))",
          gap: 14,
          alignItems: "start",
        }}
      >
        <RoundColumn
          title="First Round"
          items={rounds.firstRound}
          cardHeightPx={CARD_H}
          gapPx={GAP}
        />

        <RoundColumn
          title="Quarterfinals"
          items={rounds.quarterfinals}
          cardHeightPx={CARD_H}
          gapPx={GAP}
        />

        {/* ✅ Centered between QF pairs */}
        <RoundColumn
          title="Semifinals"
          items={rounds.semifinals}
          cardHeightPx={CARD_H}
          gapPx={SEMI_GAP}
          paddingTopPx={SEMI_PAD_TOP}
        />

        {/* ✅ Centered between SF-1 and SF-2 */}
        <RoundColumn
          title="Championship"
          items={rounds.championship}
          cardHeightPx={CARD_H}
          gapPx={GAP}
          paddingTopPx={CHAMP_PAD_TOP}
        />
      </div>

      <div style={{ fontSize: 12, opacity: 0.65 }}>
        Tip: next step is making each matchup clickable so it loads the compact JSON from HF and opens the same
        distributions UI you already use in GameCenter.
      </div>
    </div>
  );
}

function RoundColumn({
  title,
  items,
  cardHeightPx,
  gapPx,
  paddingTopPx = 0,
}: {
  title: string;
  items: MatchInfo[];
  cardHeightPx: number;
  gapPx: number;
  paddingTopPx?: number;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          opacity: 0.8,
          padding: "6px 2px",
        }}
      >
        {title}
      </div>

      <div style={{ display: "grid", gap: gapPx, paddingTop: paddingTopPx }}>
        {items.map((m) => (
          <MatchCard key={m.id} m={m} cardHeightPx={cardHeightPx} />
        ))}
      </div>
    </div>
  );
}
