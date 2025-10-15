// src/pages/CBBComingSoon.tsx
import { Link } from "react-router-dom";

export default function CBBComingSoon() {
  return (
    <main style={{ maxWidth: 900, margin: "24px auto" }}>
      <section className="card" style={{ padding: 18 }}>
        <h1 style={{ margin: 0, fontWeight: 900, fontSize: 26 }}>CBB — Coming Soon</h1>
        <p style={{ marginTop: 8, color: "var(--muted)" }}>
          We’re wiring in team-level models and a scoreboard similar to CFB. Stay tuned!
        </p>

        <div style={{ marginTop: 16 }}>
          <Link
            to="/cfb"
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
            ← Back to CFB
          </Link>
        </div>
      </section>
    </main>
  );
}
