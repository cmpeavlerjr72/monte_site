import { useEffect, useMemo, useState } from "react";

type Props = {
  venmoHandle: string;            // without "@"
  label?: string;
  defaultNote?: string;
  suggestedAmounts?: number[];    // dollars
  className?: string;
  triggerVariant?: "default" | "venmo";
};

function toMoneyAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  // limit to 2 decimals
  return Math.round(n * 100) / 100;
}

export default function SupportButton({
  venmoHandle,
  label = "Support",
  defaultNote = "Thanks for building this site 🙏",
  suggestedAmounts = [3, 5, 10],
  className, // ✅ FIX: destructure it so TS knows it exists
  triggerVariant = "default"
}: Props) {
  const [open, setOpen] = useState(false);

  // default to null (custom)
  const [amount, setAmount] = useState<number | null>(null);
  const [amountText, setAmountText] = useState<string>(""); // custom entry (string for UX)
  const [note, setNote] = useState(defaultNote);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Keep amount in sync with amountText (custom field)
  useEffect(() => {
    const parsed = toMoneyAmount(amountText);
    setAmount(parsed);
  }, [amountText]);

  const profileUrl = useMemo(() => {
    return `https://venmo.com/${encodeURIComponent(venmoHandle)}`;
  }, [venmoHandle]);

  const payUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("txn", "pay");
    params.set("recipients", venmoHandle);
    params.set("note", note || "");
    if (amount != null) params.set("amount", amount.toFixed(2));
    return `https://venmo.com/?${params.toString()}`;
  }, [venmoHandle, amount, note]);

  const selectSuggested = (a: number) => {
    setAmountText(String(a)); // drives amount via effect
  };

  const clearToCustom = () => {
    setAmountText(""); // back to null
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        style={
        triggerVariant === "venmo"
            ? {
                padding: "6px 12px",
                borderRadius: 999,                 // ✅ pill
                border: "1px solid rgba(255,255,255,0.22)",
                background: "#008CFF",             // ✅ Venmo blue
                color: "#fff",
                fontSize: 14,
                fontWeight: 900,
                letterSpacing: -0.5,
                lineHeight: 1,
                cursor: "pointer",
                boxShadow: "0 4px 10px rgba(0,0,0,0.14)",
                textTransform: "lowercase",
                fontFamily:
                '"Arial Rounded MT Bold","Helvetica Rounded","Avenir Next","Helvetica Neue",Arial,sans-serif', // ✅ closest “venmo-ish” without importing a font
            }
            : {
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid var(--border, #e5e5e5)",
                background: "var(--card, #fff)",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
            }
        }
        aria-label="Support the site"
        title="Optional support via Venmo"
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              padding: 18,
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "#ffffff",
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ display: "flex", alignItems: "start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>
                  Support the site (optional)
                </div>
                <div style={{ fontSize: 14, color: "#5b5b5b", lineHeight: 1.4 }}>
                  If this project helps you, you can optionally support it.
                  <br />
                  No paywalls, no subscriptions — just a tip jar.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "1px solid #e6e6e6",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Suggested tip chips */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, color: "#777", marginBottom: 8 }}>
                Suggested tip
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {suggestedAmounts.map((a) => {
                  const active = amountText === String(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => selectSuggested(a)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: active ? "1px solid #111" : "1px solid #d8d8d8",
                        background: active ? "#111" : "#fff",
                        color: active ? "#fff" : "#333",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                      aria-pressed={active}
                      title={`Set tip to $${a}`}
                    >
                      ${a}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={clearToCustom}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px dashed #d8d8d8",
                    background: "#fafafa",
                    color: "#666",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                  title="Enter a custom amount"
                >
                  Custom
                </button>
              </div>
            </div>

            {/* Custom amount + note */}
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "1fr 2fr",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: "#777", marginBottom: 8 }}>
                  Amount (optional)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 900 }}>$</span>
                  <input
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 5"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #e3e3e3",
                      outline: "none",
                      fontSize: 14,
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
                  Leave blank if you’d rather set it in Venmo.
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, color: "#777", marginBottom: 8 }}>
                  Note (optional)
                  Nothing About Betting in the Note Per Venmo
                </div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a short note…"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #e3e3e3",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
              </div>
            </div>

            {/* CTA */}
            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              <a
                href={payUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 12px",
                  borderRadius: 14,
                  border: "1px solid #e5e5e5",
                  background: "#f5f7ff",
                  fontWeight: 950,
                  textDecoration: "none",
                  color: "#111",
                }}
              >
                Open Venmo @{venmoHandle}
                {amount != null ? ` • $${amount.toFixed(2)}` : ""}
              </a>

              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  color: "#777",
                  textDecoration: "none",
                }}
                title="If prefill doesn’t work on your device, use the profile link"
              >
                If the amount/note doesn’t auto-fill, use the Venmo profile link instead
              </a>
            </div>

            <div style={{ marginTop: 14, fontSize: 12, color: "#777" }}>
              Thank you for keeping this project alive ❤️
            </div>
          </div>
        </div>
      )}
    </>
  );
}
