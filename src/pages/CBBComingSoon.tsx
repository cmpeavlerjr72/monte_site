// src/pages/CBBComingSoon.tsx
import { Link } from "react-router-dom";

export default function CBBComingSoon() {
  return (
    <main style={{ maxWidth: 900, margin: "24px auto" }}>
      <section className="card" style={{ padding: 18 }}>
        <h1 style={{ margin: 0, fontWeight: 900, fontSize: 26 }}>CBB — Beta</h1>
        <p style={{ marginTop: 8, color: "var(--muted)" }}>
          Feel free to play around with what is active (CBB Scoreboard Page). Continue to check back as there will be plenty of updates to come!
        </p>

        <div style={{ marginTop: 16 }}>
          <Link
            to="/cbb/scoreboard"
            style={{
              display: "inline-block",
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            ← Check out Scoreboard
          </Link>
        </div>
      </section>
    </main>
  );
}
