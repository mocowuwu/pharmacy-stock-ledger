import { getTranslations } from "next-intl/server";
import { can } from "@/lib/auth/permissions";
import { panelOverview, panelPending, panelPharmacists, panelTaxInfo } from "@/lib/dal/panel";
import { requirePermission } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { formatDate, formatDateTime, today } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { resolveRange } from "@/lib/reports/catalogue";
import Link from "next/link";
import { Alert, Card, PageHeader, Stat, SummaryRow } from "@/components/ui";
import { PrintLetterhead, RangePicker, ReportActions } from "../reports/RangePicker";
import { PanelEntryBody, PanelEntryButton, PanelEntryProvider } from "./PanelEntry";
import { PanelForm } from "./PanelForm";
import { PanelList } from "./PanelList";

export default async function PanelPage({ searchParams }: PageProps<"/panel">) {
  const session = await requirePermission("panel.view");
  // Reading the settings makes the owner's timezone the one `today()` uses; a
  // window or a default date taken from the machine's zone could be a day off.
  const settings = await getSettings();
  const t = await getTranslations();
  const query = await searchParams;

  // The same period control and the same reading of it as the reports, so a
  // preset button does something and a typed range is validated, not trusted.
  const range = resolveRange({
    preset: typeof query.preset === "string" ? query.preset : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  });

  const locale = session.user.locale;
  const period = `${formatDate(range.from, locale)} — ${formatDate(range.to, locale)}`;
  const canCreate = can(session.grant, "panel.create");
  const canVoid = can(session.grant, "panel.void");
  const canApprove = can(session.grant, "panel.approve");
  // "Everything waiting, on any date": the approver's own question, which a
  // period picker answers badly.
  const pendingView = query.status === "pending";

  const [overview, pharmacists, taxChoices, waiting] = await Promise.all([
    panelOverview(range, pendingView ? { status: "pending" } : undefined),
    canCreate ? panelPharmacists() : Promise.resolve([]),
    canCreate ? panelTaxInfo() : Promise.resolve(null),
    canApprove ? panelPending() : Promise.resolve(0),
  ]);
  const { totals } = overview;
  // The owner has nobody above them, so their orders are never held.
  const needsApproval = settings.panelApprovalRequired && !session.user.isOwner;

  return (
    <PanelEntryProvider>
      {/* The page's own paper size: A4, where receipts print on a roll. Later in
          the document than the global receipt rule, so it wins here. */}
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm 11mm; } body { font-size: 10pt !important; } }`}</style>

      <PrintLetterhead
        business={settings.businessName || t("app.name")}
        address={settings.businessAddress}
        title={t("panel.title")}
        period={period}
        printedBy={t("reports.printedBy", {
          name: session.user.fullName,
          when: formatDateTime(new Date(), locale),
        })}
      />

      <div className="print:hidden">
        <PageHeader
          title={t("panel.title")}
          subtitle={t("panel.subtitle")}
          actions={
            <ReportActions
              basePath="/panel"
              from={range.from}
              to={range.to}
              preset={range.preset}
            />
          }
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 print:hidden">
        {typeof query.voided === "string" && (
          <Alert tone="notice">{t("panel.voidedDone", { number: query.voided })}</Alert>
        )}
        {typeof query.approved === "string" && (
          <Alert tone="notice">{t("panel.approvedDone", { number: query.approved })}</Alert>
        )}
        {typeof query.rejected === "string" && (
          <Alert tone="notice">{t("panel.rejectedDone", { number: query.rejected })}</Alert>
        )}
        {pendingView ? (
          <Alert tone="notice">
            {t("panel.pendingOnly")}{" "}
            <Link href="/panel" className="-my-2 inline-block py-2 underline">
              {t("panel.pendingBack")}
            </Link>
          </Alert>
        ) : (
          waiting > 0 && (
            <Alert tone="warning">
              {t("panel.pendingNotice", { count: waiting })}{" "}
              <Link href="/panel?status=pending" className="-my-2 inline-block py-2 underline">
                {t("panel.pendingShow")}
              </Link>
            </Alert>
          )
        )}
        {typeof query.error === "string" && <Alert>{t(`errors.${query.error}`)}</Alert>}
      </div>

      {canCreate && taxChoices && (
        <PanelEntryButton openLabel={t("panel.newEntryOpen")} closeLabel={t("panel.newEntryClose")} />
      )}

      <div
        className={`grid items-start gap-x-6 ${
          canCreate && taxChoices ? "xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" : ""
        }`}
      >
        {canCreate && taxChoices && (
          // Not sticky: the form is taller than a laptop screen, and a sticky
          // block taller than the viewport leaves its Save button out of reach.
          // First in the grid, so on a phone it opens right under the button.
          <PanelEntryBody>
            <Card tour="panel-form" className="p-4 sm:p-5 print:hidden">
              <PanelForm
                today={today()}
                pharmacists={pharmacists}
                defaultPharmacistId={session.user.isPharmacist ? session.user.id : ""}
                tax={taxChoices}
                needsApproval={needsApproval}
              />
            </Card>
          </PanelEntryBody>
        )}

        <div className="@container min-w-0">
          <RangePicker basePath="/panel" preset={range.preset} from={range.from} to={range.to} />

          <div data-tour="panel-totals" className="report-panel mb-5">
            {/* Narrow, one compact card of rows: six tiles stacked were two screens
                of scrolling before the first entry, and the tiles' large figures
                do not fit two to a row in a column this narrow. The column's own
                width decides, not the screen's: beside the menu and the form a
                laptop's column is a phone's width. */}
            <Card className="p-4 @xl:hidden print:hidden">
              <div className="flex flex-col gap-2.5">
                <SummaryRow strong label={t("panel.totalRevenue")} value={formatMoney(totals.revenue)} />
                <SummaryRow label={t("panel.totalEntries")} value={totals.entries.toLocaleString()} />
                <SummaryRow label={t("panel.totalQty")} value={totals.qty.toLocaleString()} />
                {totals.tax > 0 && <SummaryRow label={t("panel.totalTax")} value={formatMoney(totals.tax)} />}
                {totals.cost !== null && (
                  <SummaryRow label={t("panel.totalCost")} value={formatMoney(totals.cost)} />
                )}
                {totals.margin !== null && (
                  <SummaryRow
                    label={t("panel.totalMargin")}
                    value={
                      <span className={totals.margin < 0 ? "text-critical" : ""}>
                        {formatMoney(totals.margin)}
                      </span>
                    }
                  />
                )}
              </div>
            </Card>

            {/* Tiles once there is room for two across, and always on paper, where
                they are a compact strip: three across with the big figure scaled
                down. */}
            <div className="hidden gap-3 @xl:grid @xl:grid-cols-2 print:grid print:grid-cols-3 print:gap-2 print:[&_.stat]:px-3 print:[&_.stat]:py-3 print:[&_.stat_.tabular]:text-[1.35rem]">
              <Stat value={totals.entries.toLocaleString()} label={t("panel.totalEntries")} />
              <Stat value={totals.qty.toLocaleString()} label={t("panel.totalQty")} />
              <Stat value={formatMoney(totals.revenue)} label={t("panel.totalRevenue")} tone="accent" />
              {totals.tax > 0 && <Stat value={formatMoney(totals.tax)} label={t("panel.totalTax")} />}
              {totals.cost !== null && (
                <Stat value={formatMoney(totals.cost)} label={t("panel.totalCost")} />
              )}
              {totals.margin !== null && (
                <Stat
                  value={formatMoney(totals.margin)}
                  label={t("panel.totalMargin")}
                  tone={totals.margin < 0 ? "critical" : "default"}
                />
              )}
            </div>
          </div>

          <PanelList
            rows={overview.rows}
            truncated={overview.truncated}
            canSeeCost={overview.canSeeCost}
            canVoid={canVoid}
            canApprove={canApprove}
            currentUserId={session.user.id}
            isOwner={session.user.isOwner}
            pendingView={pendingView}
            from={range.from}
            to={range.to}
            locale={locale}
          />
        </div>
      </div>
    </PanelEntryProvider>
  );
}
