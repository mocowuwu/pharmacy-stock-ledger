/**
 * What an old Android WebView lacks, filled in before anything else runs.
 *
 * The app supports Android 7 and later, and on those phones the WebView is
 * whatever the Play Store last installed -- on a phone that never updates it,
 * as old as Chrome 61. The build is compiled down to that level
 * (vite.config.ts), which covers syntax; this covers the few library calls
 * and the one layout feature the build cannot rewrite. Each is installed only
 * where it is missing, so an up-to-date phone runs the browser's own.
 *
 * Imported first by main.tsx. Keep it small: it runs on every start.
 */

/* Promise.prototype.finally -- Chrome 63. */
if (typeof Promise.prototype.finally !== "function") {
  Object.defineProperty(Promise.prototype, "finally", {
    configurable: true,
    writable: true,
    value: function <T>(this: Promise<T>, onFinally?: (() => void) | null) {
      if (typeof onFinally !== "function") return this.then(onFinally, onFinally);
      return this.then(
        (value) => Promise.resolve(onFinally()).then(() => value),
        (reason) =>
          Promise.resolve(onFinally()).then(() => {
            throw reason;
          }),
      );
    },
  });
}

/* Array.prototype.flatMap -- Chrome 69. One level, as the standard says. */
if (typeof Array.prototype.flatMap !== "function") {
  Object.defineProperty(Array.prototype, "flatMap", {
    configurable: true,
    writable: true,
    value: function <T, U>(this: T[], fn: (value: T, index: number, array: T[]) => U | readonly U[], thisArg?: unknown) {
      const out: U[] = [];
      for (let i = 0; i < this.length; i += 1) {
        const r = fn.call(thisArg, this[i], i, this);
        if (Array.isArray(r)) for (const x of r) out.push(x);
        else out.push(r as U);
      }
      return out;
    },
  });
}

/*
 * Flex `gap` -- Chrome 84. Without it every row of the app loses its spacing:
 * icons touch their labels, buttons touch each other. CSS cannot ask whether
 * a browser supports gap on flex boxes (`@supports (gap: 1px)` is true for
 * grid alone), so it is measured once here and styles.css spaces the rows
 * with margins under `.no-flex-gap`.
 */
if (typeof document !== "undefined") {
  const probe = document.createElement("div");
  probe.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
  probe.appendChild(document.createElement("div"));
  probe.appendChild(document.createElement("div"));
  document.documentElement.appendChild(probe);
  const supported = probe.scrollHeight === 1;
  document.documentElement.removeChild(probe);
  if (!supported) document.documentElement.className += " no-flex-gap";
}
