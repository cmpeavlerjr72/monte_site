// src/pages/site/SeasonGate.tsx: an off-season page says WHEN it is back
// instead of rendering last season as if it were current (2026-10-16).

import type { ReactNode } from "react";
import { ButtonLink, EmptyState } from "../../components/ui";
import { isOpen, type SeasonGate as Gate } from "../../lib/seasons";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

export function SeasonGate({ gate, title, body, children, archive, links }: {
  gate: Gate; title: string; body: ReactNode; children: ReactNode;
  /** Render the page anyway under an "archive" note instead of hiding it. */
  archive?: boolean;
  links?: ReactNode;
}) {
  const open = isOpen(gate);
  useDocumentMeta(open ? null : { title, noindex: true });
  if (open) return <>{children}</>;
  if (archive) {
    return (
      <div className="stack">
        <EmptyState compact kicker="Archive" title={title}>{body}</EmptyState>
        {children}
      </div>
    );
  }
  return (
    <EmptyState kicker={`Back ${gate.label}`} title={title} action={links ?? <ButtonLink to="/cfb/scoreboard">This week's board</ButtonLink>}>
      {body}
    </EmptyState>
  );
}
