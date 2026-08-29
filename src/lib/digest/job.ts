import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { settings, users } from "@/db/schema";
import { addDays, today } from "@/lib/format/date";
import { buildDigest } from "./content";
import { digestSubject, renderDigestHtml, renderDigestText } from "./render";
import { isConfigured, sendMail, type MailConfig, type SendResult } from "./send";

/**
 * The morning job.
 *
 * Runs after the alert job, on the same schedule, and reports on *yesterday* --
 * a digest sent at seven that summarised the day it was sent would summarise
 * nothing. Yesterday is a whole closed day in the pharmacy's own timezone.
 *
 * It refuses to send twice for the same day. A scheduler that fires again after
 * a restart is normal; two identical emails an hour apart teach the reader to
 * ignore both.
 */

export type DigestResult =
  | { ran: false; reason: "disabled" | "no_recipient" | "already_sent" }
  | { ran: true; on: string; quiet: boolean; delivery: SendResult };

export async function runDigestJob(
  db: Database,
  options: { on?: string; force?: boolean; previewDir?: string } = {},
): Promise<DigestResult> {
  const [config] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!config) return { ran: false, reason: "disabled" };

  if (!config.digestEnabled && !options.force) {
    return { ran: false, reason: "disabled" };
  }

  const recipient = config.digestEmail?.trim();
  if (!recipient) return { ran: false, reason: "no_recipient" };

  const on = options.on ?? addDays(today(config.timezone), -1);

  // The owner's own language: this is their email, not a customer-facing
  // document, so it follows them rather than the receipt setting.
  const [owner] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.isOwner, true))
    .limit(1);
  const locale = owner?.locale ?? "id";

  const data = await buildDigest(db, {
    on,
    timezone: config.timezone,
    business: config.businessName || "Apotek",
    expiringDays: config.expiringUrgentDays,
  });

  const mail = {
    to: recipient,
    subject: digestSubject(data, locale),
    html: renderDigestHtml(data, locale),
    text: renderDigestText(data, locale),
  };

  const mailConfig: MailConfig = {
    host: config.smtpHost,
    port: config.smtpPort,
    user: config.smtpUser,
    password: config.smtpPassword,
    from: config.smtpFrom,
    secure: config.smtpSecure,
  };

  const delivery = await sendMail(mailConfig, mail, {
    previewDir: options.previewDir,
  });

  return { ran: true, on, quiet: data.quiet, delivery };
}

/** Whether the settings would actually put an email in an inbox. */
export function digestReadiness(config: {
  digestEnabled: boolean;
  digestEmail: string | null;
  smtpHost: string | null;
  smtpFrom: string | null;
}): "off" | "no_recipient" | "preview_only" | "ready" {
  if (!config.digestEnabled) return "off";
  if (!config.digestEmail?.trim()) return "no_recipient";
  if (!isConfigured({
    host: config.smtpHost,
    from: config.smtpFrom,
    port: 0,
    user: null,
    password: null,
    secure: false,
  })) {
    return "preview_only";
  }
  return "ready";
}
