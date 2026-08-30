import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { movementsReport, type DateRange } from "@/lib/dal/reports";
import { Alert, Card, Chip, SectionHeading, Stat, buttonSecondarySmall, inputBase } from "@/components/ui";
import { formatDateTime, formatExpiry } from "@/lib/format/date";
import type { Locale } from "@/i18n/config";

/**
 * Every unit in and every unit out, per product.
 *
 * The fraud report. The other five say what the business did; this one says
 * what happened to the stock, and the two only agree if nothing went missing.
 * So it is built the opposite way round from the rest: the totals are a summary
 * of the ledger, and the ledger itself is one click away on every row.
 *
 * The per-item list is a `<details>`, not a modal or a second page. Closed, the
 * screen is a short table somebody can scan for an odd number; open, it is the
 * named, timestamped movements behind that number, which is what an accusation
 * or an exoneration actually needs. It also costs nothing on a phone, where a
 * wide table would.
 */
export async function MovementsReport({
  range,
  locale,
  itemId,
  query,
}: {
  range: DateRange;
  locale: Locale;
  itemId?: string;
  /** The period, as query parameters, so the filter form keeps it. */
  query: { preset?: string; from?: string; to?: string };
}) {
  const t = await getTranslations();
  const data = await movementsReport(range, itemId);

  // One ledger query serves every open row; the rows are bucketed here rather
  // than fetched per item, which would be one query per product on the page.
  const byItem = new Map<string, typeof data.movements>();
  for (const movement of data.movements) {
    const bucket = byItem.get(movement.itemId) ?? [];
    bucket.push(movement);
    byItem.set(movement.itemId, bucket);
  }

  const selected = data.itemId
    ? data.choices.find((choice) => choice.itemId === data.itemId)
    : null;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat value={data.qtyIn} label={t("reports.movements.unitsIn")} />
        <Stat value={data.qtyOut} label={t("reports.movements.unitsOut")} />
        <Stat
          value={data.byItem.length}
          label={t("reports.movements.products")}
          tone={data.byItem.length === 0 ? "quiet" : "default"}
        />
        <Stat
          value={data.byItem.reduce((sum, row) => sum + row.events, 0)}
          label={t("reports.movements.events")}
        />
      </div>

      {/* A plain GET form, like the period control: the chosen product lives in
          the URL, so the view is linkable and the back button works. */}
      <form
        method="get"
        action="/reports/movements"
        className="mb-6 flex flex-wrap items-end gap-2"
      >
        {query.preset && <input type="hidden" name="preset" value={query.preset} />}
        {query.from && <input type="hidden" name="from" value={query.from} />}
        {query.to && <input type="hidden" name="to" value={query.to} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
          <span className="text-xs text-muted">{t("reports.movements.product")}</span>
          <select
            name="item"
            defaultValue={data.itemId ?? ""}
            className={`${inputBase} w-full py-1.5 text-sm sm:w-72`}
          >
            <option value="">{t("reports.movements.allProducts")}</option>
            {data.choices.map((choice) => (
              <option key={choice.itemId} value={choice.itemId}>
                {choice.label} · {choice.code}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className={buttonSecondarySmall}
        >
          {t("reports.apply")}
        </button>
        {selected && (
          <Link
            href={`/reports/movements?${new URLSearchParams(
              Object.entries(query).filter(([, v]) => v) as [string, string][],
            ).toString()}`}
            className={buttonSecondarySmall}
          >
            {t("reports.movements.clearFilter")}
          </Link>
        )}
      </form>

      {data.truncated && (
        <Alert tone="notice" className="mb-4">
          {t("reports.movements.truncated")}
        </Alert>
      )}

      <SectionHeading>{t("reports.movements.byItem")}</SectionHeading>
      <p className="mb-3 -mt-1 text-sm text-muted">{t("reports.movements.note")}</p>

      {data.byItem.length === 0 ? (
        <Card className="p-6">
          <p className="text-center text-sm text-muted">{t("reports.noData")}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {data.byItem.map((row) => {
            const movements = byItem.get(row.itemId) ?? [];
            return (
              <Card key={row.itemId} className="overflow-hidden">
                <details open={!!data.itemId}>
                  {/* Stacked on a phone: sharing the line with three figures
                      truncates the medicine's name to "Amoxi…", which is the
                      one thing on the row that has to be readable. */}
                  <summary className="flex cursor-pointer list-none flex-col items-start gap-x-4 gap-y-1 px-4 py-3 marker:content-none hover:bg-surface-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {row.name}
                        {row.strength ? ` ${row.strength}` : ""}
                      </span>
                      <span className="block font-mono text-xs text-faint">
                        {row.code}
                      </span>
                    </span>
                    <span className="tabular flex w-full shrink-0 items-center gap-3 text-sm sm:w-auto">
                      {/* A zero is written "0", never "−0": a signed zero reads
                          as a number somebody has already thought about. */}
                      <span className={row.qtyIn > 0 ? "text-accent" : "text-faint"}>
                        {row.qtyIn > 0 ? `+${row.qtyIn}` : "0"}
                        <span className="ml-1 text-xs text-muted">
                          {t("reports.movements.in")}
                        </span>
                      </span>
                      <span className={row.qtyOut > 0 ? "text-critical" : "text-faint"}>
                        {row.qtyOut > 0 ? `−${row.qtyOut}` : "0"}
                        <span className="ml-1 text-xs text-muted">
                          {t("reports.movements.out")}
                        </span>
                      </span>
                      <span
                        className={`font-medium ${row.net < 0 ? "text-warning-ink" : ""}`}
                      >
                        {row.net > 0 ? "+" : ""}
                        {row.net} {row.unit}
                      </span>
                    </span>
                  </summary>

                  <div className="border-t border-rule px-4 py-3">
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {row.byType.map((bucket) => (
                        <Chip key={bucket.type}>
                          {t(`movementType.${bucket.type}`)}:{" "}
                          {bucket.qtyIn > 0 && `+${bucket.qtyIn}`}
                          {bucket.qtyIn > 0 && bucket.qtyOut > 0 && " / "}
                          {bucket.qtyOut > 0 && `−${bucket.qtyOut}`}
                        </Chip>
                      ))}
                    </div>

                    {movements.length === 0 ? (
                      <p className="text-sm text-muted">
                        {t("reports.movements.listTruncated")}
                      </p>
                    ) : (
                      <ul className="flex flex-col divide-y divide-rule/60 text-sm">
                        {movements.map((movement) => (
                          <li
                            key={movement.id}
                            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2"
                          >
                            <span
                              className={`tabular w-16 shrink-0 font-medium ${
                                movement.qtyDelta > 0 ? "text-accent" : "text-critical"
                              }`}
                            >
                              {movement.qtyDelta > 0 ? "+" : ""}
                              {movement.qtyDelta}
                            </span>
                            <span className="shrink-0">
                              {t(`movementType.${movement.type}`)}
                            </span>
                            <span className="tabular shrink-0 text-xs text-muted">
                              {formatDateTime(movement.createdAt, locale)}
                            </span>
                            <span className="shrink-0 text-xs text-muted">
                              {movement.performedBy}
                            </span>
                            {movement.document && (
                              <span className="shrink-0 font-mono text-xs text-faint">
                                {movement.document}
                              </span>
                            )}
                            <span className="shrink-0 text-xs text-faint">
                              {movement.lotNumber ?? "—"} ·{" "}
                              {formatExpiry(movement.expiryDate, locale)}
                            </span>
                            {movement.reason && (
                              <span className="w-full text-xs text-muted">
                                {movement.reason}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
