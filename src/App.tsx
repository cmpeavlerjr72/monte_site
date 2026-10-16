// src/App.tsx
import { Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Header from "./components/Header";
import InstallPrompt from "./components/InstallPrompt";
import SiteFooter from "./components/SiteFooter";
import { Skeleton, SkeletonLines } from "./components/Skeleton";
import { lazyPage, RouteErrorBoundary } from "./lib/lazyPage";

// theme.css and index.css are imported ONCE, in main.tsx, ahead of App so
// they stay first in the cascade (they were also imported here until
// 2026-10-16; the second import was a no-op).

// Every page is its own chunk (React.lazy via lazyPage, which also reloads a
// stale tab once when a post-deploy chunk is missing). See src/lib/lazyPage.tsx.

// CFB pages (existing)
const Home = lazyPage(() => import("./pages/Home"));
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
const GameCenter = lazyPage(() => import("./pages/GameCenter"));
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
const HubHome = lazyPage(() => import("./pages/HubHome"));
const CBBComingSoon = lazyPage(() => import("./pages/CBBComingSoon"));

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
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {/* ✅ your branded header (logo, colors) */}
      <Header />

      {/* Global mount: renders once, under the header, above every routed
          page. Shows only where an install is actually possible (Chromium's
          beforeinstallprompt, iOS, or the Android manual-path fallback), and
          never once installed (standalone or a detected related app). */}
      <InstallPrompt />

      <main style={{ maxWidth: 1200, margin: "20px auto", padding: "0 16px 40px" }}>
        <RouteErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteFallback />}>
        {/* Hub */}
        <Routes>
          <Route path="/" element={<HubHome />} />

          {/* CFB (namespaced) */}
          <Route path="/cfb" element={<Home />} />
          <Route path="/cfb/scoreboard" element={<Scoreboard />} />
          <Route path="/cfb/scoreboard2" element={<ScoreboardV2 />} />
          <Route path="/cfb/results" element={<Results />} />
          <Route path="/cfb/record" element={<RecordPage />} />
          <Route path="/cfb/quads" element={<QuadsPage />} />
          <Route path="/cfb/trends-clv" element={<TrendsCLV />} />
          <Route path="/cfb/game/*" element={<GameCenter />} />
          {TEST_ROUTES && <Route path="/cfb/clv/*" element={<CLVPage />} />}
          {TEST_ROUTES && <Route path="/cfb/combo/*" element={<ComboTrend />} />}
          <Route path="/cfb/bracket/*" element={<Bracket />} />
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
          <Route path="/results" element={<Navigate to="/cfb/results" replace />} />
          <Route path="/trends-clv" element={<Navigate to="/cfb/trends-clv" replace />} />
          <Route path="/game/*" element={<Navigate to="/cfb/game" replace />} />

          {/* CBB placeholder */}
          <Route path="/cbb" element={<CBBComingSoon />} />
          <Route path="/cbb/scoreboard" element={<CBB_Sims />} />
          <Route path="/cbb/results" element={<ResultsCBB />} />  
          <Route path="/cbb/bracket" element={<CBB_Bracket />} />        
          {/* MLB */}
          <Route path="/mlb" element={<MLBScoreboard />} />
          <Route path="/mlb/scoreboard" element={<MLBScoreboard />} />
          <Route path="/mlb/game/*" element={<MLBGameDetail />} />

          {/* NASCAR */}
          <Route path="/nascar" element={<NascarLive />} />
          <Route path="/nascar/live" element={<NascarLive />} />
          <Route path="/nascar/predictions" element={<NascarPredictions />} />
          <Route path="/nascar/scanner" element={<NascarScanner />} />

          {/* Tennis */}
          <Route path="/tennis" element={<TennisPredictions />} />
          <Route path="/tennis/predictions" element={<TennisPredictions />} />

          {/* College Baseball */}
          <Route path="/college-baseball" element={<CollegeBaseballScoreboard />} />
          <Route path="/college-baseball/scoreboard" element={<CollegeBaseballScoreboard />} />
          <Route path="/college-baseball/game/:id" element={<CollegeBaseballGame />} />

          {/* Hidden, DEV-ONLY (see TEST_ROUTES): sim-test scoreboard */}
          {TEST_ROUTES && <Route path="/test-visual" element={<TestVisual />} />}
          {/* Hidden, DEV-ONLY: live-gamecast component harness vs any ESPN event */}
          {TEST_ROUTES && <Route path="/test-gamecast" element={<TestGamecast />} />}
          {/* Hidden, DEV-ONLY: Bets-panel harness — the week-2 decision rules
              on a real published week against a DECLARED fixture book */}
          {TEST_ROUTES && <Route path="/test-bets" element={<TestBets />} />}

          {/* 404 -> hub */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
      </main>

      {/* Site-wide disclaimer footer, every route. */}
      <SiteFooter />
    </div>
  );
}
