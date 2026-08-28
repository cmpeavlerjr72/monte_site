// src/components/DryRunBadge.tsx
//
// "Nothing was actually sent." Worn by the My Book console and by the confirm
// popup whenever the server reports `dry_run` (or the portal payload says
// CFB_ORDERS_LIVE is unset).
//
// It is deliberately a NEUTRAL inversion — ink on the text colour — and not a
// hue. --pos/--neg on these cards mean the sign of an edge, and --mode-rest/
// --mode-take mean the execution mode; a staged order is neither of those
// things, and painting it in one of their colours would say something false.
// Inverted ink is the loudest thing available that claims no category:
// 17.7:1 on light, 16.0:1 on dark.

export default function DryRunBadge({ title }: { title?: string }) {
  return (
    <span title={title} style={{
      fontSize: 9.5, fontWeight: 900, letterSpacing: 0.6, padding: "2px 7px",
      borderRadius: 999, whiteSpace: "nowrap",
      background: "var(--text)", color: "var(--card)",
    }}>
      DRY RUN
    </span>
  );
}
