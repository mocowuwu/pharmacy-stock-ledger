import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { getSale, returnableUnits, returnsForSale } from "@/lib/dal/sales";
import { getSettings } from "@/lib/dal/settings";
import { Alert, Card, PageHeader } from "@/components/ui";
import { formatDateTime, formatExpiry } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { voidSaleAction } from "../actions";
import { PrintButton } from "@/components/PrintButton";

export default async function SaleDetailPage({
  params,
  searchParams,
}: PageProps<"/sales/[id]">) {
  const session = await requirePermission("sales.create");
  const t = await getTranslations();
  const { id } = await params;
  const query = await searchParams;

  const sale = await getSale(id);
  if (!sale) notFound();

  const refunds = await returnsForSale(id);
  // The module switch decides whether returns are offered here; it does not
  // decide whether they are possible. A return already booked still appears
  // below, and /sales/[id]/return still works if somebody has the link.
  const settings = await getSettings();
  const mayReturn = can(session.grant, "sales.return") && settings.returnsEnabled;
  // Only ask when the answer can matter: a cashier without the permission
  // never sees the card, so there is nothing to count for them.
  const returnable = mayReturn ? await returnableUnits(id) : 0;

  const locale = session.user.locale;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${t("sales.receipt")} ${sale.saleNumber}`}
          subtitle={formatDateTime(sale.soldAt, locale)}
          actions={<PrintButton label={t("sales.print")} />}
        />

        <div className="mb-4 flex flex-col gap-3">
          {query.voided && <Alert tone="notice">{t("sales.voided")}</Alert>}
          {typeof query.returned === "string" && (
            <Alert tone="notice">
              {t("returns.saved", {
                number: query.returned,
                refund: formatMoney(Number(query.refund ?? 0)),
              })}
            </Alert>
          )}
          {typeof query.error === "string" && (
            <Alert>{t(`errors.${query.error}`)}</Alert>
          )}
          {sale.status === "voided" && (
            <Alert tone="warning">
              {t("sales.voidedNotice", { reason: sale.voidReason ?? "" })}
            </Alert>
          )}
        </div>
      </div>

      {/*
        Sized for an 80mm thermal roll when printed, and readable on screen the
        rest of the time. No driver integration: the browser's own print dialog
        is what every till already has.
      */}
      <Card className="mx-auto max-w-sm p-5 print:max-w-none print:border-0 print:shadow-none">
        <div className="text-center">
          <div className="font-semibold">{t("app.name")}</div>
          <div className="tabular mt-1 text-xs text-muted">{sale.saleNumber}</div>
          <div className="tabular text-xs text-muted">
            {formatDateTime(sale.soldAt, locale)}
          </div>
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            {sale.lines.map((line) => (
              <tr key={line.id} className="align-top">
                <td className="py-1.5">
                  <div>
                    {line.itemName}
                    {line.strength ? ` ${line.strength}` : ""}
                  </div>
                  <div className="tabular text-xs text-faint">
                    {line.qty} {line.unit} × {formatMoney(line.unitPrice)}
                  </div>
                  <div className="font-mono text-xs text-faint">
                    {line.lotNumber ?? "—"} · {formatExpiry(line.expiryDate, locale)}
                  </div>
                </td>
                <td className="tabular py-1.5 text-right whitespace-nowrap">
                  {formatMoney(line.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 flex flex-col gap-1 border-t border-rule pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t("sell.subtotal")}</dt>
            <dd className="tabular">{formatMoney(sale.subtotal)}</dd>
          </div>
          {sale.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">{t("sell.discount")}</dt>
              <dd className="tabular">−{formatMoney(sale.discount)}</dd>
            </div>
          )}
          {sale.taxAmount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">
                {t("sell.tax")}
                {sale.taxRateBps ? ` ${(sale.taxRateBps / 100).toFixed(0)}%` : ""}
              </dt>
              <dd className="tabular">{formatMoney(sale.taxAmount)}</dd>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-rule pt-2 font-semibold">
            <dt>{t("sell.total")}</dt>
            <dd className="tabular">{formatMoney(sale.total)}</dd>
          </div>
          <div className="flex justify-between text-xs text-muted">
            <dt>{t("sell.paymentMethod")}</dt>
            <dd>{t(`paymentMethod.${sale.paymentMethod}`)}</dd>
          </div>
          {sale.tendered != null && (
            <>
              <div className="flex justify-between text-xs text-muted">
                <dt>{t("sell.tendered")}</dt>
                <dd className="tabular">{formatMoney(sale.tendered)}</dd>
              </div>
              <div className="flex justify-between text-xs text-muted">
                <dt>{t("sell.change")}</dt>
                <dd className="tabular">{formatMoney(sale.changeGiven ?? 0)}</dd>
              </div>
            </>
          )}
        </dl>

        <p className="mt-4 text-center text-xs text-faint">
          {t("sales.soldBy")} {sale.cashier}
        </p>
      </Card>

      <div className="mt-6 flex flex-col gap-4 print:hidden">
        {refunds.length > 0 && (
          <Card className="p-5">
            <h2 className="mb-3 font-medium">{t("returns.onSale")}</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {refunds.map((refund) => (
                <li
                  key={refund.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule/60 pb-2 last:border-0 last:pb-0"
                >
                  <span>
                    <span className="tabular font-medium">{refund.returnNumber}</span>
                    <span className="ml-2 text-muted">{refund.reason}</span>
                  </span>
                  <span className="text-right">
                    <span className="tabular">{formatMoney(refund.refundTotal)}</span>
                    <span className="ml-2 text-xs text-faint">
                      {formatDateTime(refund.returnedAt, locale)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* A return is offered before the void, because it is what should
            usually happen: a void is for a sale that should never have been
            rung up, a return is for medicine that has actually come back. */}
        {sale.status === "completed" && mayReturn && returnable > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="font-medium">{t("returns.title")}</h2>
              <p className="mt-1 text-sm text-muted">
                {t("returns.quarantineNotice")}
              </p>
            </div>
            <Link
              href={`/sales/${sale.id}/return`}
              className="rounded-lg border border-accent/40 px-4 py-2 text-sm text-accent hover:bg-accent-soft"
            >
              {t("returns.start")}
            </Link>
          </Card>
        )}

        {sale.status === "completed" &&
          can(session.grant, "sales.void") &&
          refunds.length === 0 && (
          <Card className="p-5">
            <h2 className="mb-3 font-medium">{t("sales.void")}</h2>
            <form action={voidSaleAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="saleId" value={sale.id} />
              <input
                name="reason"
                required
                placeholder={t("sales.voidReason")}
                className="min-w-60 flex-1 rounded border border-rule bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="rounded border border-critical/40 px-4 py-2 text-sm text-critical hover:bg-critical-soft"
              >
                {t("sales.voidConfirm")}
              </button>
            </form>
          </Card>
        )}

        <Link href="/sales" className="text-sm text-muted hover:text-accent">
          {t("sales.backToList")}
        </Link>
      </div>
    </>
  );
}
