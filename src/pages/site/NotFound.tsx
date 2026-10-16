// src/pages/site/NotFound.tsx: the real 404 (2026-10-16). Replaces the
// catch-all that silently bounced every typo, and /blog, to the hub.

import { useLocation } from "react-router-dom";
import { ButtonLink, EmptyState } from "../../components/ui";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

export default function NotFound() {
  const { pathname } = useLocation();
  useDocumentMeta({ title: "Page not found", noindex: true });
  return (
    <EmptyState
      kicker="404"
      title="That page isn't here"
      action={<>
        <ButtonLink to="/">Home</ButtonLink>
        <ButtonLink to="/cfb/scoreboard" variant="quiet">CFB scoreboard</ButtonLink>
        <ButtonLink to="/cfb/record" variant="quiet">The record</ButtonLink>
      </>}
    >
      <p>
        Nothing lives at <code>{pathname}</code>. It may have moved in the site refresh, or the link has a typo.
      </p>
    </EmptyState>
  );
}
