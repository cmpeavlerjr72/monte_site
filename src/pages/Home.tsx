import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Welcome</h1>
      <p style={{ marginTop: 12, opacity: 0.8 }}>
        This site hosts interactive views of my college football simulations.
      </p>
      <div style={{ marginTop: 24 }}>
        <Link to="/scoreboard" style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}>
          Go to CFB Explorer
        </Link>
      </div>
    </div>
  );
}
