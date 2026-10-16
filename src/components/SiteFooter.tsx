// src/components/SiteFooter.tsx
//
// Site-wide disclaimer footer (2026-10-16), mounted once in App.tsx under
// every route. The boards show EV, prices and order buttons, so every page
// carries the responsible-gambling line. Deliberately minimal: no nav, no
// Labs links (the design phase owns those). Styled by `.site-footer` in
// theme.css with theme tokens only.

export default function SiteFooter() {
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer__inner">
        <p className="site-footer__disclaimer">
          For entertainment and research only. Not financial or betting advice. 21+.
          Gambling problem? Call <a href="tel:18004262537">1-800-GAMBLER</a>.
        </p>
        <p className="site-footer__meta">
          <span>© MVPEAV</span>
          <span aria-hidden="true"> · </span>
          <a href="https://x.com/MVPeav" target="_blank" rel="noopener noreferrer">@MVPeav on X</a>
        </p>
      </div>
    </footer>
  );
}
