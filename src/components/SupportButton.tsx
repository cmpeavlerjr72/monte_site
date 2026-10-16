// src/components/SupportButton.tsx
//
// "Support the project": an optional Venmo tip jar. Lives in the site footer
// (2026-10-16; it was a bright-blue "donate" pill in the sport tab bar). The
// trigger is plain text styled by its caller; the dialog is a --card surface on
// theme tokens, so it reads in both themes.

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  venmoHandle: string;            // without "@"
  label?: string;
  defaultNote?: string;
  suggestedAmounts?: number[];    // dollars
  className?: string;
};

function toMoneyAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export default function SupportButton({
  venmoHandle,
  label = "Support the project",
  defaultNote = "Thanks for building this site",
  suggestedAmounts = [3, 5, 10],
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState<string>("");
  const [note, setNote] = useState(defaultNote);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const amount = toMoneyAmount(amountText);

  // Lock body scroll, focus the close button, close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const profileUrl = useMemo(() => `https://venmo.com/${encodeURIComponent(venmoHandle)}`, [venmoHandle]);
  const payUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("txn", "pay");
    params.set("recipients", venmoHandle);
    params.set("note", note || "");
    if (amount != null) params.set("amount", amount.toFixed(2));
    return `https://venmo.com/?${params.toString()}`;
  }, [venmoHandle, amount, note]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "support-trigger"}
        title="Optional support via Venmo">
        {label}
      </button>

      {open && (
        <div className="support-scrim" onClick={() => setOpen(false)}>
          <div className="support-dialog" role="dialog" aria-modal="true" aria-labelledby="support-title"
            onClick={(e) => e.stopPropagation()}>
            <div className="support-dialog__head">
              <div>
                <h2 id="support-title" className="support-dialog__title">Support the project</h2>
                <p className="support-dialog__lede">
                  Optional. No paywall, no subscription. If the sims or the record are useful to
                  you, a tip keeps the servers running.
                </p>
              </div>
              <button ref={closeRef} type="button" className="support-dialog__x" onClick={() => setOpen(false)} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" /></svg>
              </button>
            </div>

            <div className="support-dialog__label">Suggested tip</div>
            <div className="support-dialog__chips">
              {suggestedAmounts.map((a) => {
                const active = amountText === String(a);
                return (
                  <button key={a} type="button" className="ui-btn" data-on={active} aria-pressed={active}
                    onClick={() => setAmountText(String(a))}>
                    ${a}
                  </button>
                );
              })}
              <button type="button" className="ui-btn" onClick={() => setAmountText("")}>Custom</button>
            </div>

            <div className="support-dialog__fields">
              <label className="support-dialog__field">
                <span className="support-dialog__label">Amount (optional)</span>
                <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" placeholder="e.g. 5" />
                <span className="support-dialog__hint">Leave blank to set it in Venmo.</span>
              </label>
              <label className="support-dialog__field">
                <span className="support-dialog__label">Note (optional, nothing about betting, per Venmo)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short note" />
              </label>
            </div>

            <a className="btn-link btn-link--primary support-dialog__cta" href={payUrl} target="_blank" rel="noreferrer">
              Open Venmo @{venmoHandle}{amount != null ? ` · $${amount.toFixed(2)}` : ""}
            </a>
            <a className="support-dialog__alt" href={profileUrl} target="_blank" rel="noreferrer">
              If the amount or note doesn't fill in, use the Venmo profile link instead
            </a>
          </div>
        </div>
      )}
    </>
  );
}
