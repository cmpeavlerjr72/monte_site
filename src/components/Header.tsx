import { Link } from "react-router-dom";
import logoLight from "../assets/mvpeav-logo-light.png"; // on navy header

export default function Header() {
  return (
    <header className="header">
      <div style={{
        maxWidth: 1200, margin: "0 auto", padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between"
      }}>
        <Link to="/" style={{display:"flex",alignItems:"center",gap:12}}>
          <img src={logoLight} alt="MVPeav" height={40} />
          <span style={{fontWeight:800, letterSpacing:1}}>MVPEAV</span>
        </Link>
        <nav style={{display:"flex", gap:16, fontWeight:600}}>
          {/* <Link to="/cfb">CFB</Link>
          <Link to="/players">Players</Link> */}
          {/* <Link to="/game">Games</Link> */}
          <Link to="/scoreboard">Scoreboard</Link>
        </nav>
      </div>
    </header>
  );
}
