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
//
// TWO SIZES, ONE MEANING (owner 2026-09-09). At rest — the friends list, a
// profile header — flares sit on the line beside the name. In the FEED they
// are set `raised`: ~10px, lifted like an exponent, tight against the handle,
// so a row reads "@mvpeav" first and "and they're a Georgia Southern guy"
// second. Same pictures, same tooltips; only the typographic weight changes,
// because in a scrolling list the handle is the noun and the flares are a
// footnote on it.

import { readFlare } from "../lib/flares";

export default function Flares({ flares, size, raised = false }: {
  flares: string[] | null | undefined;
  /** Pixel box for each logo. Defaults to 16 inline, 10 raised. */
  size?: number;
  /** Exponent style: small, superscripted, hairline gaps. */
  raised?: boolean;
}) {
  const views = (flares ?? [])
    .map(readFlare)
    .filter((v): v is NonNullable<typeof v> => v !== null);
  if (!views.length) return null;
  const px = size ?? (raised ? 10 : 16);
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: raised ? 1 : 3,
      flexShrink: 0,
      // `vertical-align` only bites on an inline-level box, and the wrapper is
      // inline-flex, so the lift belongs here rather than on the images. The
      // small negative margin closes the space a super-scripted run leaves
      // after the handle it is a footnote on.
      verticalAlign: raised ? "super" : "baseline",
      marginLeft: raised ? 1 : 0,
    }}>
      {views.map((v) => (
        <img
          key={v.value} src={v.logo} alt="" title={v.title}
          width={px} height={px} loading="lazy"
          style={{ objectFit: "contain", display: "block" }}
        />
      ))}
    </span>
  );
}
