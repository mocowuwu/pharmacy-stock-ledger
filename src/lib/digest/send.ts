import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import nodemailer from "nodemailer";

/**
 * Sending the digest.
 *
 * Two modes, and the fallback is the point: **with no SMTP host configured the
 * email is written to a file instead of sent.** The digest is therefore
 * complete, inspectable and testable before the pharmacy has a mailbox, an API
 * key or a domain -- and the owner can look at exactly what would arrive before
 * deciding to switch it on.
 *
 * Configuration lives in the settings row rather than in environment variables,
 * because the person who knows the mailbox password is the owner, not whoever
 * deploys the container.
 */

export type MailConfig = {
  host: string | null;
  port: number;
  user: string | null;
  password: string | null;
  from: string | null;
  secure: boolean;
};

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult =
  | { delivered: true; messageId: string }
  | { delivered: false; previewPath: string; reason: "not_configured" };

/** Where a preview lands. Beside the development database, and gitignored. */
export const PREVIEW_DIR = ".data/digest";

export function isConfigured(config: MailConfig): boolean {
  return Boolean(config.host?.trim() && config.from?.trim());
}

export async function sendMail(
  config: MailConfig,
  mail: Mail,
  options: { previewDir?: string } = {},
): Promise<SendResult> {
  if (!isConfigured(config)) {
    const path = await writePreview(mail, options.previewDir ?? PREVIEW_DIR);
    return { delivered: false, previewPath: path, reason: "not_configured" };
  }

  const transport = nodemailer.createTransport({
    host: config.host!,
    port: config.port,
    // Implicit TLS on 465; on 587 nodemailer negotiates STARTTLS itself.
    secure: config.secure,
    auth: config.user
      ? { user: config.user, pass: config.password ?? "" }
      : undefined,
  });

  const info = await transport.sendMail({
    from: config.from!,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  return { delivered: true, messageId: info.messageId };
}

/**
 * Writes the email where it can be opened in a browser.
 *
 * Named for the day it covers rather than the moment it was written, so running
 * the job twice for one day overwrites rather than accumulating.
 */
export async function writePreview(
  mail: Mail,
  directory: string,
  name = "latest",
): Promise<string> {
  const path = resolve(directory, `${name}.html`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, mail.html, "utf8");
  return path;
}

/**
 * Checks the configuration by opening a connection and authenticating, without
 * sending anything. This is what the "test" button on the settings screen does:
 * a wrong password should be found when it is typed, not at seven the next
 * morning when nobody is watching.
 */
export async function verifyMail(config: MailConfig): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!isConfigured(config)) return { ok: false, error: "not_configured" };

  try {
    const transport = nodemailer.createTransport({
      host: config.host!,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });
    await transport.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
