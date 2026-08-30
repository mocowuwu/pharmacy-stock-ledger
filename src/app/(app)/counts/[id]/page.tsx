import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { getCount } from "@/lib/dal/counts";
import { Alert, Card, Chip, DrugClassMark, PageHeader, buttonPrimary, inputBase } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { formatDateTime, formatExpiry } from "@/lib/format/date";
import { cancelCountAction, postCountAction, saveSheet } from "../actions";

const STATUS_TONE = {
  draft: "neutral",
  counting: "accent",
  review: "notice",
  posted: "neutral",
  cancelled: "neutral",
} as const;

export default async function CountSheetPage({
  params,
  searchParams,
}: PageProps<"/counts/[id]">) {
  const session = await requirePermission("stock.count");
  const t = await getTranslations();
  const { id } = await params;
  const query = await searchParams;

  const count = await getCount(id);
  if (!count) notFound();

  const locale = session.user.locale;
  const open = count.status === "counting" || count.status === "review";

  const counted = count.lines.filter((line) => line.countedQty != null);
  const variances = counted.filter((line) => line.countedQty !== line.expectedQty);
  const unexplained = variances.filter((line) => !line.reason?.trim());

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${t("counts.sheet")} ${count.countNumber}`}
          subtitle={count.name}
          actions={<PrintButton label={t("counts.print")} />}
        />

        <div className="mb-4 flex flex-col gap-3">
          {query.saved && <Alert tone="notice">{t("counts.lineSaved")}</Alert>}
          {typeof query.posted === "string" && (
            <Alert tone="notice">
              {t("counts.posted", { count: query.posted })}
            </Alert>
          )}
          {query.cancelled && <Alert tone="warning">{t("counts.cancelled")}</Alert>}
          {typeof query.error === "string" && (
            <Alert>{t(`errors.${query.error}`)}</Alert>
          )}
        </div>

        <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Chip tone={STATUS_TONE[count.status]}>
              {t(`counts.status.${count.status}`)}
            </Chip>
            <span className="tabular text-muted">
              {t("counts.progress", {
                counted: counted.length,
                total: count.lines.length,
              })}
            </span>
            {variances.length > 0 ? (
              <span className="tabular text-warning-ink">
                {t("counts.variances", { count: variances.length })}
              </span>
            ) : (
              counted.length > 0 && (
                <span className="text-muted">{t("counts.noVariances")}</span>
              )
            )}
          </div>
          <div className="text-xs text-faint">
            {t("counts.startedBy")}: {count.startedBy} ·{" "}
            {formatDateTime(count.startedAt, locale)}
            {count.postedAt && (
              <>
                {" · "}
                {t("counts.postedAt")}: {formatDateTime(count.postedAt, locale)}
              </>
            )}
          </div>
        </Card>

        <p className="mb-3 text-sm text-muted">{t("counts.printHint")}</p>
      </div>

      {/* On paper this is a count sheet: the system's figure is left off so the
          person counting is not anchored by it. On screen it is a data-entry
          form and the figure is exactly what they need. */}
      <div className="hidden print:mb-4 print:block">
        <h1 className="text-lg font-semibold">
          {t("counts.sheet")} {count.countNumber} — {count.name}
        </h1>
        <p className="text-sm">
          {count.categoryName ?? t("counts.wholePharmacy")} ·{" "}
          {formatDateTime(count.startedAt, locale)}
        </p>
      </div>

      <form action={saveSheet}>
        <input type="hidden" name="countId" value={count.id} />

        <Card className="overflow-x-auto print:border-0 print:shadow-none">
          <table className="w-full min-w-[860px] text-sm print:min-w-0">
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("sell.item")}</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("dispose.batch")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap print:hidden">
                  {t("counts.expected")}
                </th>
                <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                  {t("counts.counted")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap print:hidden">
                  {t("counts.variance")}
                </th>
                <th className="px-4 py-2.5 font-medium print:hidden">
                  {t("counts.reason")}
                </th>
              </tr>
            </thead>
            <tbody>
              {count.lines.map((line) => {
                const variance =
                  line.countedQty == null ? null : line.countedQty - line.expectedQty;
                return (
                  <tr key={line.id} className="border-b border-rule/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <input type="hidden" name="lineId" value={line.id} />
                      <Link
                        href={`/items/${line.itemId}`}
                        className="font-medium hover:text-accent print:no-underline"
                      >
                        <DrugClassMark
                          drugClass={line.drugClass}
                          label={`${line.genericName}${line.strength ? ` ${line.strength}` : ""}`}
                        />
                      </Link>
                      <div className="font-mono text-xs text-faint">{line.code}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-mono text-xs">{line.lotNumber ?? "—"}</div>
                      <div className="text-xs text-faint">
                        {formatExpiry(line.expiryDate, locale)}
                        {line.batchStatus !== "active" && (
                          <span className="ml-1">
                            ({t(`batchStatus.${line.batchStatus}`)})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="tabular px-4 py-2.5 text-right whitespace-nowrap print:hidden">
                      {line.expectedQty} {line.unit}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {/* Printed, this is the box somebody writes in. */}
                      <span className="hidden print:inline-block print:h-6 print:w-24 print:border print:border-black" />
                      <input
                        name={`qty:${line.id}`}
                        inputMode="numeric"
                        disabled={!open}
                        defaultValue={line.countedQty ?? ""}
                        placeholder={t("counts.notCounted")}
                        className={`${inputBase} tabular w-24 text-center print:hidden`}
                      />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right whitespace-nowrap print:hidden">
                      {variance == null ? (
                        <span className="text-faint">—</span>
                      ) : variance === 0 ? (
                        <span className="text-faint">0</span>
                      ) : (
                        <span
                          className={
                            variance < 0 ? "text-critical" : "text-warning-ink"
                          }
                        >
                          {variance > 0 ? "+" : ""}
                          {variance}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 print:hidden">
                      <input
                        name={`reason:${line.id}`}
                        disabled={!open}
                        defaultValue={line.reason ?? ""}
                        placeholder={
                          variance != null && variance !== 0
                            ? t("counts.reasonPlaceholder")
                            : ""
                        }
                        className={`${inputBase} w-full min-w-40 ${
                          variance != null && variance !== 0 && !line.reason
                            ? "border-warning"
                            : ""
                        }`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {open && (
          <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">
            <button
              type="submit"
              className={buttonPrimary}
            >
              {t("counts.saveLine")}
            </button>
          </div>
        )}
      </form>

      {open && (
        <Card className="mt-6 flex flex-col gap-4 p-5 print:hidden">
          <div>
            <h2 className="font-medium">{t("counts.post")}</h2>
            <p className="mt-1 text-sm text-muted">{t("counts.postHint")}</p>
          </div>

          {unexplained.length > 0 && (
            <Alert tone="warning">{t("counts.explainFirst")}</Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <form action={postCountAction}>
              <input type="hidden" name="countId" value={count.id} />
              <button
                type="submit"
                disabled={unexplained.length > 0}
                className={buttonPrimary}
              >
                {t("counts.post")}
              </button>
            </form>
            <form action={cancelCountAction}>
              <input type="hidden" name="countId" value={count.id} />
              <button
                type="submit"
                className="rounded-lg border border-rule px-4 py-2.5 text-sm text-muted hover:border-critical hover:text-critical"
              >
                {t("counts.cancel")}
              </button>
            </form>
            <Link href="/counts" className="text-sm text-muted hover:text-accent">
              {t("common.back")}
            </Link>
          </div>
        </Card>
      )}
    </>
  );
}
