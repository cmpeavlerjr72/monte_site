# Social roadmap — the next package after the automatic feed (owner, 2026-09-08 ~11 PM)

Everything here is denominated in UNITS of the poster's own unit size. A dollar
amount never reaches another user (docs/ACCOUNTS_DESIGN.md, units migration).

## 1. Tail (no fade)

The product is the sim, so the feed only encourages what the sim still likes.

- Every feed item carries a **Tail** button. Pressing it opens the normal confirm
  slip for the same contract at the CURRENT ask, sized in the tailer's own unit
  (the poster's units × the tailer's unit size, under the tailer's sizing mode),
  down the normal placement route (caps, book re-check, audit, app_orders).
- **Sim-approved gate:** Tail is enabled only while the sim's net edge at the
  current ask is still positive for that side (the same pricing as the Bets
  panel: `simP − ask − fee`). Otherwise the button is muted and says why
  ("edge gone at 63¢"). No Fade button anywhere.
- A tail is recorded (`app_orders.tailed_from` = the source order id) so the
  feed can show "tailed by 3 friends" on the original and "tailed @mvpeav" on
  the copy.

## 2. Settlements in the feed, in units

- When a game settles, every feed item on that game updates in place: WON /
  LOST / PUSH and the units won or lost for that poster (`units × (1−price)/price`
  for a win, `−units` for a loss, from the poster's own price). Source: the
  server's existing settlement grading (My Book "record" path), written to
  `app_orders.settled_at / result / units_net` by a server job that runs with
  the settlements refresh.
- My Book keeps its dollar view for the owner of the book; the feed and
  everyone else's view show units only.

## 3. Records and a leaderboard

- Per user, per league (FBS Football / FCS Football / NCAAB / NCAAW), per week
  and season: bets, units net, ROI in units, CLV (price taken vs the close),
  hit rate. Computed from settled `app_orders` — one view, RLS-filtered.
- Leaderboard page (`/leaderboard`): friends by default, with an "everyone
  who opted in" tab. Opt-in flag on the profile (`show_on_leaderboard`,
  default off). Ties to the profile page as a record card.

## 4. Crowd chip on the scoreboard

- Each game card shows "N friends on this · 3 over, 1 under" from the same feed
  query (friends' open app_orders on that game), with the sides listed on tap.
  Read-only; tapping a side opens the Bets panel on that rung.

## 5. Push notifications from the feed

The site already runs a push-only service worker (fill / settlement alerts).
Add, per-user toggles on the profile:

- **A friend placed a bet** (the feed sentence as the notification body).
- **Someone tailed you.**
- **Friend request** received / accepted.
- **Score updates that move your bets** — the live one the owner asked for: on a
  score change in a game where the user has an open position (own book or a
  tailed bet), a push with the score and how the position moved: the live cover
  / over / win probability for that side from the gamecast (ESPN core-API
  probabilities, which the live panel already reads; SIM_TRAJ later), e.g.
  "Rutgers 21 – BC 17, Q3 · your Rutgers over 23.5 now 71% (was 58%)". Throttle
  to at most one push per game per user every N minutes and on every scoring
  play at most; never more than one per minute per user.
- Android is already covered by the push worker; iOS requires the PWA to be
  installed to the home screen (already the case for the pick'em PWA).

## Order of work

1. Settlement fields on `app_orders` + the server job (unblocks 2 and 3).
2. Tail with the sim-approved gate.
3. Crowd chip.
4. Records view + leaderboard page.
5. Push: friend bet / tailed / request first, then the score-update push with
   the throttle.

Guardrails to ship alongside: block and mute (hide a user's items from your feed
and yours from theirs), a report button that emails the owner, and rate limits
on friend requests.
