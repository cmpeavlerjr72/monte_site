// src/pages/site/LabsFrame.tsx: the one shared header over every Labs page
// (2026-10-16, design-system D6: tokens + a PageHeader, no redesign). The
// project name and blurb come from the site map (src/lib/siteNav.ts).

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { labsProjectOf } from "../../lib/siteNav";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

export default function LabsFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const project = labsProjectOf(pathname);
  useDocumentMeta(project ? { title: `${project.name} (Labs)`, description: project.blurb } : null);
  return (
    <div className="stack labs-frame">
      <PageHeader kicker={<Link to="/labs">Labs</Link>} title={project?.name ?? "Labs"} sub={project?.blurb} />
      <div className="labs-frame__body">{children}</div>
    </div>
  );
}
