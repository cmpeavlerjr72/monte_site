// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";
import InstallPrompt from "./components/InstallPrompt";

// ✅ restore your theme files
import "./theme.css";
import "./index.css";

// CFB pages (existing)
import Home from "./pages/Home";
import Scoreboard from "./pages/Scoreboard";
import Results from "./pages/Results";
// The 2026 record. A SEPARATE page from Results (which is the 2025 season and
// stays exactly as it was): 2026 publishes thousands of priced rungs a week
// across Kalshi team markets and game lines, so its record is a filtered view
// over a published ledger rather than one spread/ML/total per game.
import RecordPage from "./pages/Record";
import TrendsCLV from "./pages/Trends_CLV";
import GameCenter from "./pages/GameCenter";
import CLVPage from "./pages/CLV";
import ComboTrend from "./pages/combo_trend";
import Bracket from "./pages/CFB_Bracket"
// Accounts (Supabase). Both pages render an "accounts are not configured"
// line when VITE_SUPABASE_URL/ANON_KEY are absent, so the routes are safe to
// register unconditionally.
import Profile from "./pages/Profile";
import BookDashboard from "./pages/BookDashboard";
import FeedPage from "./pages/FeedPage";
import FriendPage from "./pages/FriendPage";

// CBB Pages

import CBB_Sims from "./pages/CBB_sims";
import ResultsCBB from "./pages/ResultsCBB";
import CBB_Bracket from "./pages/CBB_Bracket";

// MLB Pages
import MLBScoreboard from "./pages/MLBScoreboard";
import MLBGameDetail from "./pages/MLBGameDetail";

// NASCAR Pages
import NascarPredictions from "./pages/NascarPredictions";
import NascarScanner from "./pages/NascarScanner";
import NascarLive from "./pages/NascarLive";

// Tennis Pages
import TennisPredictions from "./pages/TennisPredictions";

// College Baseball Pages
import CollegeBaseballScoreboard from "./pages/CollegeBaseballScoreboard";
import CollegeBaseballGame from "./pages/CollegeBaseballGame";

// New pages
import HubHome from "./pages/HubHome";
import CBBComingSoon from "./pages/CBBComingSoon";

// Hidden pages (no nav entry — direct URL only)
import TestVisual from "./pages/TestVisual";
import TestGamecast from "./pages/TestGamecast";
import TestBets from "./pages/TestBets";


export default function App() {
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
        {/* Hub */}
        <Routes>
          <Route path="/" element={<HubHome />} />

          {/* CFB (namespaced) */}
          <Route path="/cfb" element={<Home />} />
          <Route path="/cfb/scoreboard" element={<Scoreboard />} />
          <Route path="/cfb/results" element={<Results />} />
          <Route path="/cfb/record" element={<RecordPage />} />
          <Route path="/cfb/trends-clv" element={<TrendsCLV />} />
          <Route path="/cfb/game/*" element={<GameCenter />} />
          <Route path="/cfb/clv/*" element={<CLVPage />} />
          <Route path="/cfb/combo/*" element={<ComboTrend />} />
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

          {/* Hidden: sim-test scoreboard (direct URL only, no nav link) */}
          <Route path="/test-visual" element={<TestVisual />} />
          {/* Hidden: live-gamecast component harness vs any ESPN event */}
          <Route path="/test-gamecast" element={<TestGamecast />} />
          {/* Hidden: Bets-panel harness — the week-2 decision rules on a real
              published week against a DECLARED fixture book */}
          <Route path="/test-bets" element={<TestBets />} />

          {/* 404 -> hub */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
