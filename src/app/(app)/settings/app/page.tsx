import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { APP_VERSION } from "@/lib/app-download";
import { APP_USER_AGENT_MARK } from "@/lib/offline/contract";
import { Alert, Card, PageHeader, SectionHeading, buttonPrimaryLarge, buttonSecondary } from "@/components/ui";

/**
 * Getting the Android app onto a phone -- for everyone who signs in, not only
 * the people who may change Settings: a cashier setting up the till phone
 * needs this page, and the app grants nobody anything their account does not
 * already have.
 *
 * The address shown is the one this page was opened on, which is exactly
 * what the phone's setup screen asks for.
 */
async function serverAddress(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const forwarded = h.get("x-forwarded-proto");
  const proto = forwarded ?? (/^(localhost|127\.|\[::1\])/u.test(host) ? "http" : host.endsWith(".ts.net") ? "https" : "http");
  return `${proto}://${host}`;
}

export default async function AndroidAppPage({ searchParams }: PageProps<"/settings/app">) {
  const session = await requireSession();
  const t = await getTranslations("androidApp");
  const query = await searchParams;
  const address = await serverAddress();
  const agent = (await headers()).get("user-agent") ?? "";
  const inAppVersion = agent.includes(APP_USER_AGENT_MARK)
    ? agent.slice(agent.indexOf(APP_USER_AGENT_MARK) + APP_USER_AGENT_MARK.length).split(/\s/u)[0]
    : null;
  const steps = ["1", "2", "3", "4", "5"] as const;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex flex-col gap-5">
        {typeof query.error === "string" && (
          <Alert tone="warning">
            {query.error === "not_published"
              ? t("errors.not_published", { version: APP_VERSION })
              : t("errors.unreachable")}
          </Alert>
        )}
        {inAppVersion && (
          <Alert tone="notice">
            {inAppVersion === APP_VERSION
              ? t("inApp", { version: inAppVersion })
              : t("inAppOlder", { version: inAppVersion, latest: APP_VERSION })}
          </Alert>
        )}

        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent shadow-[0_8px_20px_-8px_var(--accent)]"
              >
                <svg width="34" height="34" viewBox="30 30 48 48" aria-hidden="true">
                  <g transform="rotate(-45 54 54)">
                    <path fill="#FFFFFF" d="M54,40.5 L38.5,40.5 A13.5,13.5 0 0 0 25,54 A13.5,13.5 0 0 0 38.5,67.5 L54,67.5 Z" />
                    <path fill="#D9CCFF" d="M54,40.5 L69.5,40.5 A13.5,13.5 0 0 1 83,54 A13.5,13.5 0 0 1 69.5,67.5 L54,67.5 Z" />
                  </g>
                </svg>
              </span>
              <div>
                <p className="text-lg font-semibold tracking-tight">{t("appName")}</p>
                <p className="text-sm text-muted">{t("version", { version: APP_VERSION })}</p>
              </div>
            </div>
            <a href="/settings/app/download" className={buttonPrimaryLarge} download>
              {t("download")}
            </a>
          </div>
          <p className="mt-5 text-sm text-muted">{t("what")}</p>
        </Card>

        <Card className="p-6">
          <SectionHeading>{t("stepsTitle")}</SectionHeading>
          <ol className="flex flex-col gap-4">
            {steps.map((n) => (
              <li key={n} className="flex gap-3.5 text-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent tabular">
                  {n}
                </span>
                <span className="pt-1 leading-relaxed">
                  {t(`steps.${n}`)}
                  {n === "3" && (
                    <span className="mt-2 block w-fit rounded-lg border border-rule bg-surface-2 px-3 py-2 font-mono text-[0.95rem] select-all">
                      {address}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-6">
          <SectionHeading>{t("rolesTitle")}</SectionHeading>
          <p className="text-sm leading-relaxed">{t("roles")}</p>
          <p className="mt-3 text-sm text-muted">{t("offline")}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/tutorials/phoneApp" className={buttonSecondary}>
              {t("guide")}
            </Link>
            {can(session.grant, "users.manage") && (
              <Link href="/users/devices" className={buttonSecondary}>
                {t("devices")}
              </Link>
            )}
          </div>
        </Card>

        <p className="text-xs text-faint">{t("updates")}</p>
      </div>
    </>
  );
}
