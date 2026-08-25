// Slate-wide edge scan, as one self-contained hook.
//
// ------------------------------------------------------------------------
// WHY THIS IS A HOOK AND NOT THREE useMemos IN THE PAGE
// ------------------------------------------------------------------------
// The first version wired the scan inline in Scoreboard and froze the browser
// the moment anything set `enabled`:
//
//     cards      = useMemo(sortCards(..., slateEdges), [..., slateEdges])
//     edgeInputs = useMemo(cards.map(...),             [cards, ...])
//     useEffect(() => ensureSlateEdges(edgeInputs).then(setSlateEdges),
//               [edgeInputs, kalshiBySlug, ...])
//
// setSlateEdges produced a NEW Map -> `cards` recomputed to a NEW array ->
// `edgeInputs` recomputed to a NEW array -> the effect's identity-compared
// dependency changed -> the scan re-ran -> setSlateEdges again. A closed
// cycle with no fixed point, spinning as fast as React could commit.
//
// Two structural rules keep it dead:
//
//   1. The effect depends ONLY on a primitive signature string. Object and
//      array identities never reach a dependency list, so a re-render with
//      identical content cannot retrigger the scan.
//   2. Results are stored WITH the signature they were computed for, so
//      nothing needs a "clear on week change" effect (another state write
//      that could feed back), and stale results are never handed out.
//
// The caller must also derive `inputs` from the UNSORTED card list. Deriving
// them from a list that is itself sorted by the scan's output is what created
// the cycle in the first place, and rule 1 alone would only mask it.

import { useEffect, useMemo, useRef, useState } from "react";
import { ensureSlateEdges, type EdgeInput, type GameEdges } from "./edges";
import type { KalshiGame } from "./kalshi";
import type { Season } from "./cfbData";

type Params = {
  inputs: EdgeInput[];
  kalshiBySlug: Map<string, KalshiGame>;
  /** Changes when the Kalshi payload changes; part of the signature. */
  kalshiStamp: string;
  season: Season;
  /** Dataset week directory, so a week switch invalidates results. */
  weekKey: string;
  /** Mean/median changes which sim numbers the rows are built from. */
  useMean: boolean;
  /** Scan only when something actually needs the whole slate. */
  enabled: boolean;
};

export type SlateEdgesResult = {
  edges: Map<string, GameEdges> | null;
  loading: boolean;
};

export function useSlateEdges({
  inputs, kalshiBySlug, kalshiStamp, season, weekKey, useMean, enabled,
}: Params): SlateEdgesResult {
  // Results carry the signature they belong to, so a stale map is never shown.
  const [state, setState] = useState<{ sig: string; map: Map<string, GameEdges> } | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Everything that changes the ANSWER, and nothing that merely changes an
   * object identity. This is a string, so React's Object.is comparison on the
   * effect's dependency list is a value comparison.
   */
  const signature = useMemo(() => {
    if (!enabled || !season || !inputs.length) return "";
    return [
      season,
      weekKey,
      useMean ? "mean" : "med",
      kalshiStamp,
      inputs.map((i) => i.slug).join(","),
    ].join("|");
  }, [enabled, season, weekKey, useMean, kalshiStamp, inputs]);

  // Live values for the effect to read without depending on their identity.
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const kalshiRef = useRef(kalshiBySlug);
  kalshiRef.current = kalshiBySlug;

  // Belt and braces: even if a future edit slips an unstable value into the
  // dependency list, a signature is scanned at most once.
  const startedRef = useRef("");

  useEffect(() => {
    if (!signature) return;
    if (startedRef.current === signature) return;
    startedRef.current = signature;

    const ac = new AbortController();
    let alive = true;
    setLoading(true);

    ensureSlateEdges(inputsRef.current, kalshiRef.current, season, ac.signal)
      .then((map) => {
        if (alive) setState({ sig: signature, map });
      })
      .catch((err) => {
        if ((err as any)?.name !== "AbortError") {
          console.warn("[edges] slate scan failed:", err);
          // Allow a retry on the next trigger rather than wedging the guard.
          if (startedRef.current === signature) startedRef.current = "";
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      ac.abort();
    };
    // season is captured for the call; it is already inside `signature`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return {
    edges: state && state.sig === signature ? state.map : null,
    loading: loading && !(state && state.sig === signature),
  };
}
