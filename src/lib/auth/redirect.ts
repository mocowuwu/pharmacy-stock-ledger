/**
 * Whether a `next` value from the sign-in URL is safe to send somebody to.
 *
 * Only a path on this site. `//evil.example` is protocol-relative and leaves
 * the site; so is `/\evil.example`, because browsers read a backslash in a URL
 * as a forward slash -- which is how the original `startsWith("//")` check
 * let a crafted sign-in link bounce staff to another site after a real,
 * successful sign-in. Control characters are refused too: browsers strip tabs
 * and newlines from URLs, so `/\t/evil.example` is the same trick again.
 */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next || !next.startsWith("/")) return false;
  if (next[1] === "/" || next[1] === "\\") return false;
  if (/[\u0000-\u001f\u007f]/u.test(next)) return false;
  return true;
}
