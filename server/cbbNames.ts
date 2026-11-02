// Team-name normalization for the Kalshi <-> CBB slate join.
//
// Pure, like ./cfbNames.ts. Basketball reuses the football key (cfbNameKey,
// which already folds accents / "St." / "Saint" / "University" and carries
// the shared KALSHI_TEAM_ALIASES) and layers a basketball-only overlay on
// top of it. The overlay is applied AFTER cfbNameKey and only on the CBB
// path, never merged into the football table, because the two sports'
// slates spell some schools differently: the FCS football slate's
// "St. Thomas (MN)" is aliased DOWN to Kalshi's "statethomas", while the
// basketball slate writes "St. Thomas-Minnesota", so here Kalshi's form is
// aliased UP to ours. Merging the tables would break one sport or the other.
//
// Same rule as the football file: both sides of the join run through this
// one function, so each entry maps Kalshi's key onto OUR slate's key (on the
// RIGHT), and it must never collapse two different schools onto one key.

import { cfbNameKey } from "./cfbNames.js";

/** Basketball-only overlay; keys and values are already cfbNameKey forms. */
export const CBB_ALIASES: Record<string, string> = {
  // Kalshi "Seattle", ESPN slate "Seattle U".
  seattle: "seattleu",
  // Kalshi "FDU", slate "Fairleigh Dickinson".
  fdu: "fairleighdickinson",
  // Kalshi "USC Upstate", slate "South Carolina Upstate".
  uscupstate: "southcarolinaupstate",
  // Kalshi "St. Thomas" (and "St. Thomas (MN)", which the football table
  // already folds to statethomas), slate "St. Thomas-Minnesota".
  statethomas: "statethomasminnesota",
  statethomasmn: "statethomasminnesota",
};

export function cbbNameKey(s: string): string {
  const k = cfbNameKey(s);
  return CBB_ALIASES[k] ?? k;
}

/** Unordered team-pair key for matching a Kalshi CBB event to one of our games. */
export const cbbPairKeyOf = (a: string, b: string) =>
  [cbbNameKey(a), cbbNameKey(b)].sort().join("__");
