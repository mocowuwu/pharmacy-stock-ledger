import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { alertConfig } from "@/lib/dal/alerts";
import { Alert, Card, Chip, PageHeader, SectionHeading, buttonSecondary } from "@/components/ui";
import { RulesForm } from "./RulesForm";

/**
 * What this pharmacy counts as an alert.
 *
 * Behind `alerts.configure`, which the owner hands out on the accounts screen
 * -- not `settings.manage`, and not the `alerts.manage` that lets someone mark
 * an alert as handled. The two critical rules are shown here and are not
 * inputs: expired stock on the shelf and an empty shelf are facts, and there
 * is no setting that makes either of them quieter.
 */
export default async function AlertRulesPage({ searchParams }: PageProps<"/alerts/rules">) {
  await requirePermission("alerts.configure");
  const t = await getTranslations();
  const query = await searchParams;
  const config = await alertConfig();

  return (
    <>
      <PageHeader
        title={t("alertRules.title")}
        subtitle={t("alertRules.subtitle")}
        actions={
          <Link href="/alerts" className={buttonSecondary}>
            {t("alertRules.back")}
          </Link>
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        {typeof query.saved === "string" && (
          <Alert tone="notice">
            {t("alertRules.saved", { count: Number(query.saved) || 0 })}{" "}
            <Link href="/alerts" className="underline">
              {t("alertRules.openList")}
            </Link>
          </Alert>
        )}
        {typeof query.error === "string" && <Alert>{t(`errors.${query.error}`)}</Alert>}
      </div>

      <section className="mb-8">
        <SectionHeading>{t("alertRules.always")}</SectionHeading>
        <Card className="p-4 sm:p-5">
          <ul className="flex flex-col gap-3">
            {(["expired_stock", "out_of_stock"] as const).map((type) => (
              <li key={type} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Chip tone="critical">{t("alertSeverity.critical")}</Chip>
                <span className="font-medium">{t(`alertType.${type}`)}</span>
                <span className="basis-full text-sm text-muted">{t(`alertRules.fixed.${type}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-rule pt-3 text-xs text-faint">{t("alertRules.alwaysNote")}</p>
        </Card>
      </section>

      <section>
        <SectionHeading>{t("alertRules.yours")}</SectionHeading>
        <RulesForm thresholds={config.thresholds} rules={config.rules} />
      </section>
    </>
  );
}
