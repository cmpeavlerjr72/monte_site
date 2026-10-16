// src/pages/site/Labs.tsx: /labs, the index of side projects (2026-10-16).
// These moved out of the main nav; their pages and URLs are unchanged.

import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { LABS } from "../../lib/siteNav";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

export default function Labs() {
  useDocumentMeta({
    title: "Labs",
    description: "Side projects from MVPEAV: MLB game sims, a NASCAR race model and scanner, tennis predictions and a college baseball scoreboard.",
  });
  return (
    <div className="stack">
      <PageHeader
        kicker="Labs"
        title="Side projects"
        sub="Models and tools built along the way. They run, they update, and some are off-season. The main event is college football and basketball."
      />
      <div className="labs-list">
        {LABS.map((l) => (
          <Link key={l.id} to={l.home} className="labs-row">
            <span className="labs-row__name">{l.name}</span>
            <span className="labs-row__blurb">{l.blurb}</span>
            <span className="labs-row__pages">{l.pages.map((p) => p.label).join(" · ")}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
