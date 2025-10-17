// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";

// ✅ restore your theme files
import "./theme.css";
import "./index.css";

// CFB pages (existing)
import Home from "./pages/Home";
import Scoreboard from "./pages/Scoreboard";
import Results from "./pages/Results";
import TrendsCLV from "./pages/Trends_CLV";
import GameCenter from "./pages/GameCenter";

// CBB Pages

import CBB_Sims from "./pages/CBB_sims";

// New pages
import HubHome from "./pages/HubHome";
import CBBComingSoon from "./pages/CBBComingSoon";

export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {/* ✅ your branded header (logo, colors) */}
      <Header />

      <main style={{ maxWidth: 1200, margin: "20px auto", padding: "0 16px 40px" }}>
        {/* Hub */}
        <Routes>
          <Route path="/" element={<HubHome />} />

          {/* CFB (namespaced) */}
          <Route path="/cfb" element={<Home />} />
          <Route path="/cfb/scoreboard" element={<Scoreboard />} />
          <Route path="/cfb/results" element={<Results />} />
          <Route path="/cfb/trends-clv" element={<TrendsCLV />} />
          <Route path="/cfb/game/*" element={<GameCenter />} />

          {/* Legacy redirects to preserve old links */}
          <Route path="/scoreboard" element={<Navigate to="/cfb/scoreboard" replace />} />
          <Route path="/results" element={<Navigate to="/cfb/results" replace />} />
          <Route path="/trends-clv" element={<Navigate to="/cfb/trends-clv" replace />} />
          <Route path="/game/*" element={<Navigate to="/cfb/game" replace />} />

          {/* CBB placeholder */}
          <Route path="/cbb" element={<CBBComingSoon />} />
          <Route path="/cbb/scoreboard" element={<CBB_Sims />} />
          {/* 404 -> hub */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
