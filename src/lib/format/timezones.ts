/**
 * Timezones the owner can choose from.
 *
 * The three Indonesian zones sit at the top under the names staff actually use
 * -- WIB, WITA, WIT -- because those are what appear on a delivery note and in
 * conversation, not "Asia/Makassar". Everything else the platform knows about
 * follows, so a pharmacy anywhere is not stuck.
 *
 * This is not cosmetic. The timezone decides when a day ends, which decides
 * which day a sale belongs to and the moment a batch counts as expired.
 */

export const INDONESIAN_TIMEZONES = [
  { zone: "Asia/Jakarta", abbreviation: "WIB", offset: "UTC+7" },
  { zone: "Asia/Makassar", abbreviation: "WITA", offset: "UTC+8" },
  { zone: "Asia/Jayapura", abbreviation: "WIT", offset: "UTC+9" },
] as const;

const PINNED = new Set(INDONESIAN_TIMEZONES.map((t) => t.zone));

/**
 * Every zone the runtime knows, minus the pinned ones.
 *
 * `supportedValuesOf` is not in every runtime, so the fallback is the pinned
 * list alone -- a shorter menu is better than a crash on a screen the owner
 * needs to reach the rest of the settings.
 */
export function otherTimezones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return supported.filter((zone) => !PINNED.has(zone as never));
}

/** `Asia/Jakarta (WIB, UTC+7)` for a pinned zone, the raw name otherwise. */
export function timezoneLabel(zone: string): string {
  const pinned = INDONESIAN_TIMEZONES.find((t) => t.zone === zone);
  return pinned ? `${pinned.zone} — ${pinned.abbreviation}, ${pinned.offset}` : zone;
}

/** Whether a stored value is a zone this runtime can actually use. */
export function isKnownTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * What the machine is set to, when it differs from the pharmacy's setting.
 *
 * Worth surfacing: this project was built on a machine in WITA while the
 * default setting said WIB, and an hour's difference at the wrong end of the
 * day moves a sale into yesterday.
 */
export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
