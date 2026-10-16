// src/components/ui/TeamCell.tsx: logo + school name. Its own module because
// the logo lookup carries the team table (see the note in ./index.tsx).

import type { ReactNode } from "react";
import { getTeamLogo } from "../../utils/teamLogo";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/** Logo + school name. The logo is decorative when the name is printed beside
 *  it (alt=""), so a screen reader hears the name once. */
export function TeamCell({ team, sub, size = 22, logo, className }: {
  team: string; sub?: ReactNode; size?: number; logo?: string | null; className?: string;
}) {
  const src = logo === undefined ? getTeamLogo(team) : logo || undefined;
  return (
    <span className={cx("team-cell", className)}>
      {src ? (
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className="team-cell__logo" />
      ) : (
        <span className="team-cell__logo team-cell__logo--none" style={{ width: size, height: size }} aria-hidden="true" />
      )}
      <span className="team-cell__words">
        <span className="team-cell__name">{team}</span>
        {sub && <span className="team-cell__sub">{sub}</span>}
      </span>
    </span>
  );
}

