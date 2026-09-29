/**
 * Whether this deployment is the hosted demo.
 *
 * Set by `DEMO_MODE=1` on the Vercel project and nowhere else -- never on a
 * clinic install. It does two things: labels every screen so the demo is never
 * mistaken for a live pharmacy, and stops outgoing mail. Everything else runs
 * the real rules, because a demo that relaxes them demonstrates nothing.
 */
export function isDemo(): boolean {
  return process.env.DEMO_MODE === "1";
}
