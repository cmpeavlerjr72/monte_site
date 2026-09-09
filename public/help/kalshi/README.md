# Kalshi linking screenshots

These images sit under each numbered step of the "First time? Here is how to
get a Kalshi API key" walkthrough on the My Book dashboard
(`src/components/KalshiLinkCard.tsx`). They are **optional**: a file that is
not here hides its own image element (`onError`) and the step keeps its words,
so nothing breaks and no broken-image icon appears.

| file | what it should show |
|---|---|
| `step1.png` | Kalshi's top-right account menu open, with **Account & security** in the list |
| `step2.png` | The **Create API key** dialog: nickname box, the optional public-key box (left empty), and the permission checkboxes (**Read all data** + **Full access**) |
| `step3.png` | The **"Keep your key safe"** screen: the API key id box and the private key box, shown once |
| `step4.png` | *(not supplied yet)* This site's link card with the Key ID and the private key file filled in |

Rules for the files:

- **Blur anything real** — a key id, a private key, a balance, an email. The
  images ship to every visitor of the dashboard.
- Keep each one **under ~300 KB**. They are lazy-loaded and capped at 420px
  wide on screen; a 2 MB screenshot buys nothing and costs every phone.
- PNG, and keep the names exactly as above — the component addresses them by
  filename.
- Re-shoot rather than annotate: the caption and the alt text under each image
  already say what to look for (`Step` in KalshiLinkCard.tsx).
