// src/components/InstallPrompt.tsx
/**
 * "Install app" affordance — a slim, dismissible bar under the header.
 *
 * Two platforms, two mechanisms:
 *   • Chromium (Android Chrome/Edge/Samsung, desktop Chrome/Edge) fires
 *     `beforeinstallprompt`. We stash it and hand it back on click, which opens
 *     the real one-tap OS install dialog.
 *   • iOS/iPadOS has NO programmatic install API in any browser — every engine
 *     there is WebKit — so the same button opens a two-step guide instead.
 *   • Android WITHOUT a stashed event (Chrome suppresses the event for a
 *     cooldown after a dismissal, and forever once installed) gets the same
 *     button after a short grace period; it opens a manual-path guide instead
 *     of doing nothing.
 *
 * Dismissal is deliberately narrow: opening either guide is install INTENT,
 * not a decline, so closing a guide (X or backdrop tap) never hides the bar.
 * Only the banner's own X, or an explicit "dismissed" from Chrome's native
 * dialog, hides it — and only for a 7-day snooze, never permanently, because
 * a permanent dismissal from one accidental tap is what bit real users on
 * the sibling pickem app.
 *
 * Visibility is otherwise conservative: nothing renders when the app is
 * already installed (standalone display-mode, an `appinstalled` event this
 * session, or Chromium's `getInstalledRelatedApps` reporting our own app),
 * and nothing renders on a browser that neither fired the event nor is
 * iOS/Android, so a context that cannot install never sees a button that
 * cannot work.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  clearInstallPrompt,
  getInstallPrompt,
  hasInstalledRelatedApp,
  isAndroid,
  isIOS,
  isStandalone,
  markInstalled,
  subscribeInstallPrompt,
  wasInstalled,
} from "../lib/pwa";

/** The old boolean meant "never show again" — retired: dismissal is now a
 * timestamped snooze, and this key is deliberately left unread. */
const LEGACY_DISMISS_KEY = "mvpeav.installPrompt.dismissed";
const SNOOZE_KEY = "mvpeav.installPrompt.snoozeUntil";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long to wait for Chrome to offer an install before falling back to
 * manual instructions on Android. Chrome suppresses `beforeinstallprompt`
 * for a cooldown after a dismissal (and forever once installed), so "no
 * event yet" is not "cannot install" — without this grace period the button
 * silently never appears on a returning Android visitor.
 */
const OFFER_GRACE_MS = 3000;

/** Storage is a convenience, never a dependency: private mode throws on both. */
function readSnoozedUntil(): number {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    const until = raw ? Number(raw) : 0;
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}
function writeSnooze(): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* Blocked storage just means the bar comes back next visit. */
  }
}

export default function InstallPrompt() {
  // The event is stashed at module load in ../lib/pwa (Chrome fires it before
  // React mounts), so this component SUBSCRIBES to the stash. It never
  // registers a window listener of its own — that is the bug this avoids.
  const deferred = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPrompt,
    () => null,
  );
  const appInstalled = useSyncExternalStore(
    subscribeInstallPrompt,
    wasInstalled,
    () => false,
  );

  const [snoozedUntil, setSnoozedUntil] = useState<number>(() => readSnoozedUntil());
  const [guide, setGuide] = useState<"ios" | "android" | null>(null);
  const [relatedAppInstalled, setRelatedAppInstalled] = useState(false);
  /** Android only: Chrome had its chance to offer an install and didn't. */
  const [graceElapsed, setGraceElapsed] = useState(false);

  const ios = isIOS();
  const android = isAndroid();

  // Chromium installed-app check: the one signal that tells "already
  // installed" apart from "in a beforeinstallprompt cooldown". Cheap and
  // safe everywhere else (feature-detected, try/catch, false when absent).
  useEffect(() => {
    let cancelled = false;
    hasInstalledRelatedApp().then((yes) => {
      if (!cancelled && yes) setRelatedAppInstalled(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Android only: start the grace clock before offering the manual-path
  // fallback button.
  useEffect(() => {
    if (!android) return;
    const timer = window.setTimeout(() => setGraceElapsed(true), OFFER_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [android]);

  const onInstallClick = useCallback(async () => {
    const evt = getInstallPrompt();
    if (evt) {
      try {
        await evt.prompt();
        const { outcome } = await evt.userChoice;
        if (outcome === "accepted") {
          markInstalled();
          return;
        }
        // A native "dismissed" choice is a real decline — snooze it, same as
        // the banner's own X, but never permanently.
        writeSnooze();
        setSnoozedUntil(Date.now() + SNOOZE_MS);
      } catch {
        /* A rejected/aborted prompt must not become an unhandled rejection. */
      }
      // The event is single-use either way; Chrome re-fires (and the module
      // re-stashes) on a later visit if the user declined.
      clearInstallPrompt();
      return;
    }
    // No event to hand back: show the manual path for this platform. Opening
    // the guide is install INTENT, not a decline — it must never snooze.
    setGuide(isIOS() ? "ios" : "android");
  }, []);

  const onDismiss = useCallback(() => {
    writeSnooze();
    setSnoozedUntil(Date.now() + SNOOZE_MS);
    setGuide(null);
  }, []);

  const installed = appInstalled || isStandalone() || relatedAppInstalled;
  const snoozed = snoozedUntil > Date.now();
  if (installed || snoozed) return null;

  // Android with no offer after the grace period still gets the button — it
  // just opens instructions instead of the OS dialog.
  const androidFallback = android && graceElapsed && !deferred;
  if (!deferred && !ios && !androidFallback) return null;

  return (
    <>
      <div className="install-bar" role="region" aria-label="Install this app">
        <span className="install-bar__text">
          Add MVPEAV to your home screen.
        </span>
        <button type="button" className="install-bar__cta" onClick={onInstallClick}>
          Install app
        </button>
        <button
          type="button"
          className="install-bar__x"
          onClick={onDismiss}
          aria-label="Dismiss install prompt"
        >
          &times;
        </button>
      </div>

      {guide && (
        <div
          className="install-sheet__scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Add to Home Screen"
          onClick={() => setGuide(null)}
        >
          <div className="install-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="install-sheet__head">
              <strong>Add to Home Screen</strong>
              <button
                type="button"
                className="install-bar__x"
                onClick={() => setGuide(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            {guide === "ios" ? (
              <>
                <ol className="install-sheet__steps">
                  <li>
                    <span>
                      Tap the <b>Share</b> button in the browser toolbar
                    </span>
                    <ShareGlyph />
                  </li>
                  <li>
                    <span>
                      Choose <b>Add to Home Screen</b>
                    </span>
                    <PlusSquareGlyph />
                  </li>
                </ol>
                <p className="install-sheet__note">
                  Works in Safari, and in Chrome or Edge on iOS 16.4 and later.
                  Already added it? You&apos;re all set — open it from your
                  home screen.
                </p>
              </>
            ) : (
              <>
                <ol className="install-sheet__steps">
                  <li>
                    <span>
                      Tap the <b>⋮ menu</b> in the Chrome toolbar
                    </span>
                    <DotsGlyph />
                  </li>
                  <li>
                    <span>
                      Choose <b>Add to Home screen</b> (or <b>Install app</b>)
                    </span>
                    <PhonePlusGlyph />
                  </li>
                </ol>
                <p className="install-sheet__note">
                  Chrome only offers its one-tap install once in a while —
                  this is the manual route. Already added it? You&apos;re all
                  set — open it from your home screen.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** iOS Share: a box with an arrow leaving through the top. */
function ShareGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3v11M12 3l-3.5 3.5M12 3l3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.5H5.25A1.25 1.25 0 0 0 4 11.75v7A1.25 1.25 0 0 0 5.25 20h13.5A1.25 1.25 0 0 0 20 18.75v-7a1.25 1.25 0 0 0-1.25-1.25H17.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The "Add to Home Screen" row icon: a plus inside a rounded square. */
function PlusSquareGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 8.5v7M8.5 12h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Chrome's overflow menu: three vertical dots. */
function DotsGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <circle cx="12" cy="5" r="1.9" />
        <circle cx="12" cy="12" r="1.9" />
        <circle cx="12" cy="19" r="1.9" />
      </g>
    </svg>
  );
}

/** "Add to Home screen": a phone with a plus on it. */
function PhonePlusGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="6"
        y="2.5"
        width="12"
        height="19"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 8.5v7M8.5 12h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
