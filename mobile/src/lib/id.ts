/**
 * A random version-4 UUID.
 *
 * `crypto.randomUUID()` only arrived in Chrome 92, and the till runs on
 * Android 7 phones whose WebView may be years older: there it is undefined,
 * and calling it threw at setup (the device id) and at every sale (the
 * client id). `getRandomValues` has been there since Chrome 11 and draws from
 * the same generator, so the fallback is as random as the original.
 */
export function randomId(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (!c || typeof c.getRandomValues !== "function") {
    // Every WebView the app supports has getRandomValues; refusing is better
    // than inventing ids from Math.random that could collide on the server.
    throw new Error("No secure random number generator");
  }
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  let hex = "";
  for (let i = 0; i < 16; i += 1) hex += (b[i] + 0x100).toString(16).slice(1);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
