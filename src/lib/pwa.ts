/**
 * Service-worker registration + the install-prompt plumbing.
 *
 * Registration is hand-written rather than generated (vite-plugin-pwa runs with
 * `injectRegister: false`) so the update path is reviewable: a stale, pinned
 * service worker is THE classic PWA failure, and on a site whose whole value is
 * fresh numbers it would be a silent data bug, not a cosmetic one.
 */

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
