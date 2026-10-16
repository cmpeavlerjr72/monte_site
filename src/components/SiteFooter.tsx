// src/components/SiteFooter.tsx
//
// Site-wide footer, mounted once in App.tsx under every route. The boards show
// EV, prices and (for linked owners) order buttons, so every page carries the
// responsible-gambling line. Also the home of everything that left the header
// in the 2026-10-16 refresh: the Labs side projects, Support (was a bright
// "donate" pill), @MVPeav, and the light/dark toggle (was only on the classic
// scoreboard's toolbar).

import { Link } from "react-router-dom";
import SupportButton from "./SupportButton";
import { LABS, MAIN_NAV } from "../lib/siteNav";
import { useThemeMode, type ThemeMode } from "../lib/usePrefs";

const THEME_WORDS: Record<ThemeMode, string> = { system: "Auto", light: "Light", dark: "Dark" };

function ThemeToggle() {
  const { mode, setMode } = useThemeMode();
  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m}
          className={`theme-toggle__opt${mode === m ? " is-on" : ""}`} onClick={() => setMode(m)}>
          {THEME_WORDS[m]}
        </button>
      ))}
    </div>
  );
}

export default function SiteFooter() {
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer__inner">
        <div className="site-footer__cols">
          <div className="site-footer__col site-footer__brand">
            <div className="site-footer__word">MVPEAV</div>
            <p className="site-footer__tag">Sims, projects and experiments.</p>
            <ThemeToggle />
          </div>
          <nav className="site-footer__col" aria-label="Footer: site">
            <div className="site-footer__head">Site</div>
            {MAIN_NAV.map((i) => <Link key={i.to} to={i.to}>{i.label}</Link>)}
          </nav>
          <nav className="site-footer__col" aria-label="Footer: labs">
            <div className="site-footer__head"><Link to="/labs">Labs</Link></div>
            {LABS.map((l) => <Link key={l.id} to={l.home}>{l.name}</Link>)}
          </nav>
          <div className="site-footer__col">
            <div className="site-footer__head">Follow</div>
            <a href="https://x.com/MVPeav" target="_blank" rel="noopener noreferrer">@MVPeav on X</a>
            <SupportButton venmoHandle="Mitchell-Peavler" className="site-footer__linkbtn" />
          </div>
        </div>
        <p className="site-footer__disclaimer">
          For entertainment and research only. Not financial or betting advice. 21+.
          Gambling problem? Call <a href="tel:18004262537">1-800-GAMBLER</a>.
        </p>
        <p className="site-footer__meta">© {new Date().getFullYear()} MVPEAV</p>
      </div>
    </footer>
  );
}
