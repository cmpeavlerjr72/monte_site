/**
 * Service-worker registration + the install-prompt stash.
 *
 * Registration is hand-written rather than generated (vite-plugin-pwa runs with
 * `injectRegister: false`) so the update path is reviewable: a stale, pinned
 * service worker is THE classic PWA failure, and on a site whose whole value is
 * fresh numbers it would be a silent data bug, not a cosmetic one.
 *
 * The `beforeinstallprompt` listener lives HERE, at module scope, and not in a
 * component effect. Chrome fires that event once, early — routinely before
 * React has mounted — so an effect-registered listener misses it, the install
 * button never appears, and Chrome shows its own mini-infobar instead. (Cost a
 * real device test on the sibling pickem app.) This module is imported by
 * src/main.tsx, so it is evaluated before `createRoot().render()` runs; the
 * component subscribes to the stash rather than to the event.
 */

/** Not in lib.dom yet — Chromium-only, and it is the entire install API. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let stashedPrompt: BeforeInstallPromptEvent | null = null;
let didInstall = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // preventDefault suppresses Chrome's mini-infobar so OUR button is the
    // single entry point — and it is also what makes the event reusable later.
    e.preventDefault();
    stashedPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    didInstall = true;
    stashedPrompt = null;
    notify();
  });
}

/** Current stashed event, or null. Stable identity — safe as a store snapshot. */
export const getInstallPrompt = (): BeforeInstallPromptEvent | null => stashedPrompt;

/** True once `appinstalled` has fired in this session. */
export const wasInstalled = (): boolean => didInstall;

/** Drop a spent event. Chrome re-fires (and re-stashes) on a later visit. */
export function clearInstallPrompt(): void {
  stashedPrompt = null;
  notify();
}

export function markInstalled(): void {
  didInstall = true;
  stashedPrompt = null;
  notify();
}

export function subscribeInstallPrompt(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/** True when the page is running as an installed app rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    iosStandalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true
  );
}

/**
 * iOS/iPadOS has no programmatic install API in ANY browser — every engine on
 * the platform is WebKit, so Chrome and Edge for iOS need the same Share-sheet
 * instructions Safari does (and since iOS 16.4 they can actually perform it).
 * iPadOS reports itself as a Mac, hence the touch-point probe.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // The FIRST worker to claim this page is claiming the very load that
  // installed it — the assets on screen are already that build, so reloading
  // would just be a flash. Only a REPLACEMENT controller means new code, and
  // that is the case worth a reload.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Re-check on every return to the tab: a phone that lives on the home
        // screen for a week otherwise never asks whether a deploy happened.
        const check = () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", check);
        window.setInterval(check, 60 * 60 * 1000);
      })
      .catch(() => {
        /* No worker is a fully working site; never break boot over it. */
      });
  });
}
