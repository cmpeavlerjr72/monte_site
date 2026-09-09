// src/components/Flares.tsx
//
// A person's FLARES, inline, wherever they are named — the feed, the friends
// list, the profile page. LOGOS ONLY, with the school name as the tooltip: a
// flare is a glance, and three school names spelled out beside a username
// would out-shout the username.
//
// The logo comes from `getTeamLogo` (via src/lib/flares.ts), the same helper
// the Top Edges rows badge their teams with, so a school here and a school
// there are the same picture from the same file.

import { readFlare } from "../lib/flares";

export default function Flares({ flares, size = 16 }: {
  flares: string[] | null | undefined;
  size?: number;
}) {
  const views = (flares ?? [])
    .map(readFlare)
    .filter((v): v is NonNullable<typeof v> => v !== null);
  if (!views.length) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
      {views.map((v) => (
        <img
          key={v.value} src={v.logo} alt="" title={v.title}
          width={size} height={size} loading="lazy"
          style={{ objectFit: "contain", display: "block" }}
        />
      ))}
    </span>
  );
}
