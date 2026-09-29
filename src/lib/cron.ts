import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a request may run a scheduled job over HTTP.
 *
 * Only the hosted demo schedules jobs this way -- Vercel calls the route with
 * `Authorization: Bearer <CRON_SECRET>`. A clinic install runs its jobs from
 * the installer's supervisor and sets no secret, and with no secret this
 * refuses everything, so the route does nothing on a clinic machine.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  // Hashed first so the comparison is constant-time whatever the lengths.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
