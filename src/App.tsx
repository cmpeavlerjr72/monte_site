// src/App.tsx
import { Link, Routes, Route, NavLink } from "react-router-dom";
import Home from "./pages/Home";
import CFB from "./pages/CFB";
import Players from "./pages/Players"; // <-- add

export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a" }}>
      <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "12px 16px", display: "flex", gap: 24, alignItems: "center" }}>
          <Link to="/" style={{ fontSize: 20, fontWeight: 800 }}>Sim Site</Link>
          <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
            <NavLink to="/" end style={({ isActive }) => ({ fontWeight: isActive ? 700 : 400, opacity: isActive ? 1 : 0.7 })}>Home</NavLink>
            <NavLink to="/cfb" style={({ isActive }) => ({ fontWeight: isActive ? 700 : 400, opacity: isActive ? 1 : 0.7 })}>CFB</NavLink>
            <NavLink to="/players" style={({ isActive }) => ({ fontWeight: isActive ? 700 : 400, opacity: isActive ? 1 : 0.7 })}>Players</NavLink>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cfb" element={<CFB />} />
          <Route path="/players" element={<Players />} /> {/* <-- add */}
        </Routes>
      </main>

      <footer style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", fontSize: 12, opacity: 0.7 }}>
        © {new Date().getFullYear()} — built with React
      </footer>
    </div>
  );
}
