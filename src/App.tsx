// src/App.tsx
import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Home from "./pages/Home";
import CFB from "./pages/CFB";
import Players from "./pages/Players";
import "./theme.css";
import "./index.css";

export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <Header />
      <main style={{ maxWidth: 1200, margin: "20px auto", padding: "0 16px 40px" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cfb" element={<CFB />} />
          <Route path="/players" element={<Players />} />
        </Routes>
      </main>
    </div>
  );
}
