// src/App.tsx
import { Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SeasonGate } from "./pages/site/SeasonGate";
import { GATES } from "./lib/seasons";
// The shared Labs header (tiny; eager so a Labs page never flashes headerless).
import LabsFrame from "./pages/site/LabsFrame";
import Header from "./components/Header";
import InstallPrompt from "./components/InstallPrompt";
import { SiteTicker } from "./components/site/ScoreTicker";
import SiteFooter from "./components/SiteFooter";
import { Skeleton, SkeletonLines } from "./components/Skeleton";
import { lazyPage, RouteErrorBoundary } from "./lib/lazyPage";
import { useTrafficTracking } from "./lib/track";

// theme.css and index.css are imported ONCE, in main.tsx, ahead of App so
// they stay first in the cascade (they were also imported here until
// 2026-10-16; the second import was a no-op).

// Every page is its own chunk (React.lazy via lazyPage, which also reloads a
// stale tab once when a post-deploy chunk is missing). See src/lib/lazyPage.tsx.

// CFB pages (existing)
const Scoreboard = lazyPage(() => import("./pages/Scoreboard"));
const ScoreboardV2 = lazyPage(() => import("./pages/ScoreboardV2"));
const Results = lazyPage(() => import("./pages/Results"));
// The 2026 record. A SEPARATE page from Results (which is the 2025 season and
// stays exactly as it was): 2026 publishes thousands of priced rungs a week
// across Kalshi team markets and game lines, so its record is a filtered view
// over a published ledger rather than one spread/ML/total per game.
const RecordPage = lazyPage(() => import("./pages/Record"));
const QuadsPage = lazyPage(() => import("./pages/Quads"));
const TrendsCLV = lazyPage(() => import("./pages/Trends_CLV"));
const CLVPage = lazyPage(() => import("./pages/CLV"));
const ComboTrend = lazyPage(() => import("./pages/combo_trend"));
const Bracket = lazyPage(() => import("./pages/CFB_Bracket"));
// Accounts (Supabase). Both pages render an "accounts are not configured"
// line when VITE_SUPABASE_URL/ANON_KEY are absent, so the routes are safe to
// register unconditionally.
const Profile = lazyPage(() => import("./pages/Profile"));
const BookDashboard = lazyPage(() => import("./pages/BookDashboard"));
const FeedPage = lazyPage(() => import("./pages/FeedPage"));
const FriendPage = lazyPage(() => import("./pages/FriendPage"));

// CBB Pages

const CBB_Sims = lazyPage(() => import("./pages/CBB_sims"));
const ResultsCBB = lazyPage(() => import("./pages/ResultsCBB"));
const CBB_Bracket = lazyPage(() => import("./pages/CBB_Bracket"));

// MLB Pages
const MLBScoreboard = lazyPage(() => import("./pages/MLBScoreboard"));
const MLBGameDetail = lazyPage(() => import("./pages/MLBGameDetail"));

// NASCAR Pages
const NascarPredictions = lazyPage(() => import("./pages/NascarPredictions"));
const NascarScanner = lazyPage(() => import("./pages/NascarScanner"));
const NascarLive = lazyPage(() => import("./pages/NascarLive"));

// Tennis Pages
const TennisPredictions = lazyPage(() => import("./pages/TennisPredictions"));

// College Baseball Pages
const CollegeBaseballScoreboard = lazyPage(() => import("./pages/CollegeBaseballScoreboard"));
const CollegeBaseballGame = lazyPage(() => import("./pages/CollegeBaseballGame"));

// New pages
// Site pages (2026-10-16 refresh)
const SiteHome = lazyPage(() => import("./pages/site/Home"));
const SportHome = lazyPage(() => import("./pages/site/SportHome"));
const About = lazyPage(() => import("./pages/site/About"));
const HowItWorks = lazyPage(() => import("./pages/site/HowItWorks"));
const Labs = lazyPage(() => import("./pages/site/Labs"));
const RecordShell = lazyPage(() => import("./pages/site/RecordShell"));
const BlogIndex = lazyPage(() => import("./pages/blog/BlogIndex"));
const BlogPost = lazyPage(() => import("./pages/blog/BlogPost"));
const PreviewPost = lazyPage(() => import("./pages/blog/PreviewPost"));
const NotFound = lazyPage(() => import("./pages/site/NotFound"));

/** A redirect that keeps the query string (?season=&week= on the boards). */
function RedirectKeepSearch({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

/** /cfb and /cbb are the sports' home pages now, but older links carried the
 *  board's ?season=/week=/game= on them: those still land on the board. */
function SportHomeOrBoard({ sport }: { sport: "cfb" | "cbb" }) {
  const { search } = useLocation();
  return search.length > 1 ? <RedirectKeepSearch to={`/${sport}/scoreboard`} /> : <SportHome sport={sport} />;
}

// DEV-ONLY routes. The test harnesses (and the unlinked 2025 CLV / Combo
// pages) are registered only in `vite dev` or a build made with
// VITE_ENABLE_TEST_ROUTES=1. In a normal production build their paths fall
// through to the catch-all: /test-bets exposed the owner's sizing rules and
// Combo shows small-sample "true edge" ROI. Files are kept, not deleted.
const TEST_ROUTES =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_ROUTES === "1";

// Hidden pages (no nav entry — direct URL only)
const TestVisual = lazyPage(() => import("./pages/TestVisual"));
const TestGamecast = lazyPage(() => import("./pages/TestGamecast"));
const TestBets = lazyPage(() => import("./pages/TestBets"));
// Owner-only traffic stats (2026-10-18): no nav entry; the server gates the data.
const TrafficStats = lazyPage(() => import("./pages/TrafficStats"));
const SimBook = lazyPage(() => import("./pages/SimBook"));
const Desk = lazyPage(() => import("./pages/Desk"));
const DeskWrite = lazyPage(() => import("./pages/DeskWrite"));


/** Shown while a route's chunk downloads (usually a few hundred ms). */
function RouteFallback() {
  return (
    <div aria-busy="true" aria-label="Loading page" style={{ display: "grid", gap: 16 }}>
      <Skeleton height={32} width="40%" />
      <SkeletonLines rows={3} height={14} />
      <Skeleton height={240} />
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  useTrafficTracking();
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)" }}>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header />

      {/* Global mount: renders once, under the header, above every routed
          page. Shows only where an install is actually possible (Chromium's
          beforeinstallprompt, iOS, or the Android manual-path fallback), and
          never once installed (standalone or a detected related app). */}
      <InstallPrompt />

      {/* The score ticker, full width under the header (home and /cfb only). */}
      <SiteTicker />

      <main id="main" tabIndex={-1} style={{ flex: "1 0 auto", width: "100%", maxWidth: "var(--content-max)", margin: "24px auto 0", padding: "0 16px" }}>
        <RouteErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteFallback />}>
        {/* Hub */}
        <Routes>
          <Route path="/" element={<SiteHome />} />
          {/* Blog. /nhl and /fantasy-ai are tag landing pages until those
              projects have boards of their own. */}
          <Route path="/blog" element={<BlogIndex />} />
          <Route path="/blog/tag/:tag" element={<BlogIndex />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/preview/:token" element={<PreviewPost />} />
          <Route path="/nfl" element={<SportHome sport="nfl" />} />
          <Route path="/nhl" element={<BlogIndex tag="nhl" />} />
          <Route path="/fantasy-ai" element={<BlogIndex tag="fantasy-ai" />} />
          <Route path="/about" element={<About />} />
          <Route path="/about/how-it-works" element={<HowItWorks />} />

          {/* CFB (namespaced). The V2 board IS the scoreboard (2026-10-16);
              the classic board stays one more stretch at -classic, and the
              old /scoreboard2 URL forwards with its query string. /cfb
              itself goes to the board; the old /cfb guide is now
              /about/how-it-works. */}
          <Route path="/cfb" element={<SportHomeOrBoard sport="cfb" />} />
          <Route path="/cfb/scoreboard" element={<ScoreboardV2 />} />
          <Route path="/cfb/scoreboard-classic" element={<Scoreboard />} />
          <Route path="/cfb/scoreboard2" element={<RedirectKeepSearch to="/cfb/scoreboard" />} />
          {/* THE RECORD: season tabs. 2026 is the ledger; the 2025 archive is
              the old /cfb/results page, which now redirects there. */}
          <Route path="/cfb/record" element={<RecordShell season="2026"><RecordPage /></RecordShell>} />
          <Route path="/cfb/record/2025" element={<RecordShell season="2025"><Results /></RecordShell>} />
          <Route path="/cfb/results" element={<RedirectKeepSearch to="/cfb/record/2025" />} />
          <Route path="/cfb/quads" element={<QuadsPage />} />
          {/* Trends reads 2025 CSVs that 2026 does not publish: hidden (dev
              builds only) until it is rebuilt on the 2026 JSON. */}
          {TEST_ROUTES && <Route path="/cfb/trends-clv" element={<TrendsCLV />} />}
          {/* Game sims retired 2026-10-16: the expanded board card shows every sim. Old
              links (?week=&game=) land on the board with that game focused. */}
          <Route path="/cfb/game/*" element={<RedirectKeepSearch to="/cfb/scoreboard" />} />
          {TEST_ROUTES && <Route path="/cfb/clv/*" element={<CLVPage />} />}
          {TEST_ROUTES && <Route path="/cfb/combo/*" element={<ComboTrend />} />}
          <Route path="/cfb/bracket/*" element={
            <SeasonGate gate={GATES.cfbBracket} title="The CFP bracket opens on Selection Sunday"
              body={<p>Last season's bracket is retired. The 2026-27 field, our simulated odds for every team and the pick-your-bracket tool come back the day the committee reveals the 12.</p>}>
              <Bracket />
            </SeasonGate>
          } />
          {/* THE ACCOUNT PAGES REDIRECT UP. They were under /cfb until
              2026-09-08; an account is sport-agnostic (same login, same Kalshi
              book, same friends when CBB arrives), so they now live at the
              root and these keep every old link working. */}
          <Route path="/cfb/me" element={<Navigate to="/me" replace />} />
          <Route path="/cfb/mybook" element={<Navigate to="/mybook" replace />} />
          <Route path="/cfb/feed" element={<Navigate to="/feed" replace />} />
          <Route path="/cfb/friends" element={<Navigate to="/me" replace />} />

          {/* THE ACCOUNT, SPORT-AGNOSTIC (owner 2026-09-08). Three
              destinations answering three questions, mounted at the top level
              because none of them is about college football in particular:
                /mybook  what I have riding, resting and settled
                /feed    what my friends are on
                /me      who I am, who sees me, my friends, my sizing, my
                         Kalshi link
              The scoreboards stay under /cfb and /cbb. */}
          <Route path="/mybook" element={<BookDashboard />} />
          <Route path="/feed" element={<FeedPage />} />
          {/* One person, everything they are on — reached from any handle. */}
          <Route path="/u/:handle" element={<FriendPage />} />
          <Route path="/me" element={<Profile />} />

          {/* Legacy redirects to preserve old links */}
          <Route path="/scoreboard" element={<Navigate to="/cfb/scoreboard" replace />} />
          <Route path="/results" element={<Navigate to="/cfb/record/2025" replace />} />
          <Route path="/game/*" element={<RedirectKeepSearch to="/cfb/scoreboard" />} />

          {/* CBB. The football V2 board IS the basketball scoreboard too
              (one component, sport="cbb": the 2027 dataset mirrors the
              football layout with days in place of weeks); the old basketball
              page stays reachable at -classic, like football's. */}
          <Route path="/cbb" element={<SportHomeOrBoard sport="cbb" />} />
          <Route path="/cbb/scoreboard" element={<ScoreboardV2 sport="cbb" />} />
          <Route path="/cbb/scoreboard-classic" element={<CBB_Sims />} />
          <Route path="/cbb/results" element={<ResultsCBB />} />
          <Route path="/cbb/bracket" element={
            <SeasonGate gate={GATES.cbbBracket} archive title="March 2026 bracket (archive)"
              body={<p>This is last season's tournament, frozen as of March 17, 2026. The 2027 bracket goes live on Selection Sunday, March 14.</p>}>
              <CBB_Bracket />
            </SeasonGate>
          } />

          {/* Labs: side projects. Old URLs below are unchanged. */}
          <Route path="/labs" element={<Labs />} />
          {/* MLB */}
          <Route path="/mlb" element={<LabsFrame><MLBScoreboard /></LabsFrame>} />
          <Route path="/mlb/scoreboard" element={<LabsFrame><MLBScoreboard /></LabsFrame>} />
          <Route path="/mlb/game/*" element={<LabsFrame><MLBGameDetail /></LabsFrame>} />

          {/* NASCAR */}
          <Route path="/nascar" element={<LabsFrame><NascarLive /></LabsFrame>} />
          <Route path="/nascar/live" element={<LabsFrame><NascarLive /></LabsFrame>} />
          <Route path="/nascar/predictions" element={<LabsFrame><NascarPredictions /></LabsFrame>} />
          <Route path="/nascar/scanner" element={<LabsFrame><NascarScanner /></LabsFrame>} />

          {/* Tennis */}
          <Route path="/tennis" element={<LabsFrame><TennisPredictions /></LabsFrame>} />
          <Route path="/tennis/predictions" element={<LabsFrame><TennisPredictions /></LabsFrame>} />

          {/* College Baseball */}
          <Route path="/college-baseball" element={<LabsFrame><CollegeBaseballScoreboard /></LabsFrame>} />
          <Route path="/college-baseball/scoreboard" element={<LabsFrame><CollegeBaseballScoreboard /></LabsFrame>} />
          <Route path="/college-baseball/game/:id" element={<LabsFrame><CollegeBaseballGame /></LabsFrame>} />

          {/* Hidden, DEV-ONLY (see TEST_ROUTES): sim-test scoreboard */}
          {TEST_ROUTES && <Route path="/test-visual" element={<TestVisual />} />}
          <Route path="/stats" element={<TrafficStats />} />
          <Route path="/simbook" element={<SimBook />} />
          <Route path="/desk" element={<Desk />} />
          <Route path="/desk/write/:id" element={<DeskWrite />} />
          {/* Hidden, DEV-ONLY: live-gamecast component harness vs any ESPN event */}
          {TEST_ROUTES && <Route path="/test-gamecast" element={<TestGamecast />} />}
          {/* Hidden, DEV-ONLY: Bets-panel harness — the week-2 decision rules
              on a real published week against a DECLARED fixture book */}
          {TEST_ROUTES && <Route path="/test-bets" element={<TestBets />} />}

          {/* A real 404 (it used to bounce every unknown path to the hub). */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
      </main>

      {/* Site-wide disclaimer footer, every route. */}
      <SiteFooter />
    </div>
  );
}
