// src/pages/TestGamecast.tsx
//
// Hidden dev harness (no nav link — direct URL only, same pattern as
// /test-visual): renders the live-gamecast components against ANY real ESPN
// event, live or finished, so they can be eyeballed without waiting for a
// live slate. The field strip gets a situation synthesized from the last
// drive when the game is over.
//
//   /test-gamecast                → tonight's default event
//   /test-gamecast?event=4018...  → any college football event id

import { useEffect, useMemo, useState } from "react";
import { FieldStrip, LiveGamePanel } from "../components/LiveGamecast";
import { parseSummaryLite, type LiveSituation } from "../lib/espnGame";

const SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=";

export default function TestGamecast() {
  const eventId = useMemo(
    () => new URLSearchParams(window.location.search).get("event") ?? "401866532",
    []
  );
  const [raw, setRaw] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${SUMMARY}${eventId}`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => !cancelled && setRaw(j))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (err) return <div style={{ color: "var(--neg)" }}>Failed: {err}</div>;
  if (!raw) return <div style={{ color: "var(--muted)" }}>Loading {eventId}…</div>;

  const comp = raw?.header?.competitions?.[0];
  const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
  const bits = {
    homeAbbrev: home?.team?.abbreviation,
    awayAbbrev: away?.team?.abbreviation,
    homeId: home?.team?.id != null ? String(home.team.id) : undefined,
    awayId: away?.team?.id != null ? String(away.team.id) : undefined,
    homeColor: home?.team?.color ? `#${home.team.color}` : undefined,
    awayColor: away?.team?.color ? `#${away.team.color}` : undefined,
    homeLogo: home?.team?.logos?.[0]?.href,
    awayLogo: away?.team?.logos?.[0]?.href,
  };

  const lite = parseSummaryLite(raw);
  const d = lite.drive;
  const lastPlay = d?.plays?.length ? d.plays[d.plays.length - 1] : undefined;
  const situation: LiveSituation = {
    yardLine: d?.ballYL,
    downDistanceText: lastPlay?.startDD,
    possessionId: d?.teamId,
    attackDir: d?.attackDir,
    isRedZone:
      d?.ballYL !== undefined && d?.attackDir !== undefined
        ? (d.attackDir === -1 ? d.ballYL <= 20 : d.ballYL >= 80)
        : false,
    lastPlayText: lastPlay?.text,
  };

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Gamecast harness — {away?.team?.displayName} @ {home?.team?.displayName}{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
          ({comp?.status?.type?.shortDetail ?? "?"} · event {eventId})
        </span>
      </h2>

      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
          FieldStrip (card-sized, situation synthesized from last drive)
        </div>
        <div style={{ maxWidth: 340 }}>
          <FieldStrip situation={situation} bits={bits} />
        </div>
      </section>

      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
          LiveGamePanel (isLive forced on so the drive field + play list render)
        </div>
        <LiveGamePanel
          eventId={eventId}
          isLive={true}
          situation={situation}
          bits={bits}
          simHomeWinPct={62}
        />
      </section>
    </div>
  );
}
