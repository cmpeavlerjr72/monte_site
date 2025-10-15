// src/pages/HubHome.tsx
import { Link } from "react-router-dom";

export default function HubHome() {
  return (
    <main style={{ maxWidth: 900, margin: "24px auto" }}>
      <section className="card" style={{ padding: 18 }}>
        <h1 style={{ margin: 0, fontWeight: 900, fontSize: 28 }}>Welcome to Sports Sim Hub</h1>
        <p style={{ marginTop: 8, color: "var(--muted)" }}>
          Pick a sport to explore simulations, results, and trends.
        </p>

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          <Link
            to="/cfb"
            className="card"
            style={{
              padding: 16,
              border: "1px solid var(--border)",
              borderRadius: 14,
              textDecoration: "none",
              background: "var(--card)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 18 }}>College Football (CFB)</div>
            <div style={{ marginTop: 6, color: "var(--muted)" }}>
              Go to the current site (unchanged): Scoreboard, Results, Trends & more.
            </div>
          </Link>

          <Link
            to="/cbb"
            className="card"
            style={{
              padding: 16,
              border: "1px solid var(--border)",
              borderRadius: 14,
              textDecoration: "none",
              background: "var(--card)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 18 }}>College Basketball (CBB)</div>
            <div style={{ marginTop: 6, color: "var(--muted)" }}>
              Placeholder page for now — models & UI coming soon.
            </div>
          </Link>
        </div>
      </section>
    </main>
  );
}
