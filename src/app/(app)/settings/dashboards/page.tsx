import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { dashboardAccounts } from "@/lib/dal/dashboard";
import { Alert, Card, PageHeader, SectionHeading, buttonSecondary } from "@/components/ui";
import { DEFAULT_LAYOUT, WIDGETS } from "@/lib/dashboard/widgets";
import { DashboardEditor } from "./DashboardEditor";

/**
 * Where the owner builds each account's Beranda.
 *
 * Owner only, and not a permission: a manager holding `settings.manage` is
 * sent back to the dashboard. The server action and the DAL check again -- this
 * redirect is the courtesy, not the control.
 */
export default async function DashboardsPage({ searchParams }: PageProps<"/settings/dashboards">) {
  const session = await requireSession();
  if (!session.user.isOwner) redirect("/");

  const t = await getTranslations();
  const query = await searchParams;
  const accounts = await dashboardAccounts();

  const chosen =
    accounts.find((account) => account.id === query.user) ?? accounts[0] ?? null;

  // Listed widgets first, in their saved order; the rest follow, switched off.
  const order = chosen?.custom ?? [...DEFAULT_LAYOUT];
  const rows = chosen
    ? [
        ...order.map((key) => ({ key, on: true })),
        ...WIDGETS.filter((key) => !order.includes(key)).map((key) => ({ key, on: false })),
      ].map((row) => ({ ...row, allowed: chosen.allowed.includes(row.key as never) }))
    : [];

  return (
    <>
      <PageHeader
        title={t("dashboardEditor.title")}
        subtitle={t("dashboardEditor.subtitle")}
        actions={
          <Link href="/settings" className={buttonSecondary}>
            {t("dashboardEditor.back")}
          </Link>
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        {query.saved === "1" && <Alert tone="notice">{t("dashboardEditor.saved")}</Alert>}
        {query.saved === "reset" && <Alert tone="notice">{t("dashboardEditor.savedReset")}</Alert>}
        {typeof query.error === "string" && <Alert>{t(`errors.${query.error}`)}</Alert>}
      </div>

      <section className="mb-8">
        <SectionHeading>{t("dashboardEditor.accounts")}</SectionHeading>
        <div className="flex flex-wrap gap-2">
          {accounts.map((account) => (
            <Link
              key={account.id}
              href={`/settings/dashboards?user=${account.id}`}
              aria-current={account.id === chosen?.id ? "true" : undefined}
              className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${
                account.id === chosen?.id
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-rule bg-surface"
              }`}
            >
              <span className="font-medium">{account.fullName}</span>
              <span className="text-xs text-faint">
                {account.custom === null
                  ? t("dashboardEditor.isDefault")
                  : t("dashboardEditor.isCustom")}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {chosen && (
        <section>
          <SectionHeading>
            {t("dashboardEditor.forAccount", { name: chosen.fullName })}
          </SectionHeading>
          <Card className="mb-4 p-4 text-sm text-muted">
            {t("dashboardEditor.permissionNote")}
          </Card>
          {/* Keyed by account: switching accounts must reset the arrangement. */}
          <DashboardEditor key={chosen.id} userId={chosen.id} rows={rows} />
        </section>
      )}
    </>
  );
}
