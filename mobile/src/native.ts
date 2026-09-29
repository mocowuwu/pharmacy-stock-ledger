/**
 * The Android side, as JavaScript sees it: `window.PharmacyNative`, a
 * `@JavascriptInterface` object added by `NativeBridge.java`.
 *
 * Calls are synchronous (the WebView blocks the page for the duration), which
 * is what lets "write the sale, then show the receipt" be two plain lines.
 *
 * Outside the Android app -- `npm run dev` in a desktop browser -- a stand-in
 * backed by localStorage is used so the screens can be worked on. It is not a
 * security boundary and is never used on a phone: the real object is present
 * before the first line of the shell runs.
 */

export interface PharmacyNative {
  /** SystemClock.elapsedRealtime(): ms since boot, monotonic, unaffected by the date setting. */
  elapsedRealtime(): number;
  /** Settings.Global.BOOT_COUNT; -1 if the phone does not report it. */
  bootCount(): number;
  /** File contents, or null when absent. Names must match /^[a-z]+\.json$/. */
  readFile(name: string): string | null;
  /** Atomic: temp file, fsync, rename. False when refused or failed. */
  writeFile(name: string, content: string): boolean;
  deleteFile(name: string): boolean;
  /** Prints the WebView's current page through Android's print dialog. */
  print(jobName: string): void;
  appVersion(): string;
  /** The first screen has drawn; the launch screen may give way. */
  ready(): void;
  /** Tells the native side which origin may stay in the WebView. Only from https://localhost. */
  setServerOrigin(origin: string): boolean;
}

declare global {
  interface Window {
    PharmacyNative?: PharmacyNative;
  }
}

function browserStandIn(): PharmacyNative {
  const prefix = "pharmacy-native:";
  // A fresh "boot" per browser session, so the pass behaves as on a phone that
  // was restarted when the tab is closed.
  let boot = Number(sessionStorage.getItem(`${prefix}boot`) ?? "0");
  if (!boot) {
    boot = Math.floor(Math.random() * 1_000_000) + 1;
    sessionStorage.setItem(`${prefix}boot`, String(boot));
  }
  const origin = Number(sessionStorage.getItem(`${prefix}origin`) ?? "0") || Date.now();
  sessionStorage.setItem(`${prefix}origin`, String(origin));
  return {
    elapsedRealtime: () => Date.now() - origin,
    bootCount: () => boot,
    readFile: (name) => localStorage.getItem(prefix + name),
    writeFile: (name, content) => {
      localStorage.setItem(prefix + name, content);
      return true;
    },
    deleteFile: (name) => {
      localStorage.removeItem(prefix + name);
      return true;
    },
    print: () => window.print(),
    appVersion: () => "dev",
    ready: () => undefined,
    setServerOrigin: () => true,
  };
}

let cached: PharmacyNative | null = null;

export function native(): PharmacyNative {
  if (cached) return cached;
  cached = window.PharmacyNative ?? browserStandIn();
  return cached;
}

export function isInsideApp(): boolean {
  return typeof window !== "undefined" && window.PharmacyNative !== undefined;
}
