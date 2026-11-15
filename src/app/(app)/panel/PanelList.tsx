import { getTranslations } from "next-intl/server";
import { Card, Chip, EmptyState, Th, inputClass, inputSmall } from "@/components/ui";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { panelAmounts } from "@/lib/panel/amounts";
import type { PanelViewRow } from "@/lib/panel/entries";
import { decidePanelEntryAction, voidPanelEntryAction } from "./actions";

/**
 * The entries, as a table where there is width for one and as cards where there
 * is not.
 *
 * A ten-column table in a 340px column is a table you scroll sideways to read
 * the quantity and never see the money, so narrower than the table needs each
 * entry is a card that says what a person wants from the list -- who it is for,
 * what, how much, where it stands -- and carries its own buttons, sized for a
 * thumb. Both are drawn from the same rows by the same arithmetic.
 *
 * "Narrower" is measured on the list's own box (a container query), not on the
 * screen. The screen is the wrong ruler: beside the menu, and beside the order
 * form on a laptop, a 1280px screen leaves the list about 580px, which is a
 * phone's worth. Paper always gets the table: a printed page is not a phone, and
 * its width is not what the query measures.
 */
export async function PanelList({
  rows,
  truncated,
  canSeeCost,
  canVoid,
  canApprove,
  currentUserId,
  isOwner,
  pendingView,
  from,
  to,
  locale,
}: {
  rows: PanelViewRow[];
  truncated: boolean;
  canSeeCost: boolean;
  canVoid: boolean;
  /** May decide waiting entries. The logic still refuses a person's own. */
  canApprove: boolean;
  currentUserId: string;
  isOwner: boolean;
  /** The list is "everything waiting, any date", not a period. */
  pendingView: boolean;
  from: string;
  to: string;
  locale: "id" | "en";
}) {
  const t = await getTranslations("panel");

  if (rows.length === 0) {
    return (
      <Card tour="panel-list" className="p-6">
        <EmptyState
          title={pendingView ? t("pendingEmpty") : t("empty")}
          body={pendingView ? undefined : t("emptyBody")}
        />
      </Card>
    );
  }

  const hasActions = canVoid || canApprove;
  // Carried through every action so the person lands back on the same list.
  const keep = (
    <>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      {pendingView && <input type="hidden" name="status" value="pending" />}
    </>
  );

  /** Everything about a row that both layouts need, worked out once. */
  const model = (row: PanelViewRow) => {
    const voided = row.voidedAt !== null;
    const amounts = panelAmounts(row);
    return {
      voided,
      counted: row.status === "approved" && !voided,
      amounts,
      // Margin is on what the pharmacy keeps: the price less any PPN sitting
      // inside it, less cost -- the gross profit report's own arithmetic.
      margin: row.unitCost === null ? null : amounts.net - row.qty * row.unitCost,
      mayDecide:
        canApprove &&
        row.status === "pending" &&
        !voided &&
        (isOwner || row.recordedById !== currentUserId),
      mayVoid: canVoid && !voided && row.status !== "rejected",
    };
  };

  const taxLine = (row: PanelViewRow) =>
    row.taxMode === null
      ? null
      : row.taxMode === "exclusive"
        ? t("taxLineTop", { tax: formatMoney(row.taxAmount) })
        : t("taxLineInside", { tax: formatMoney(row.taxAmount) });

  /** Where the entry stands, in words: voided, waiting, rejected, or approved by someone else. */
  const standing = (row: PanelViewRow, voided: boolean) => (
    <>
      {voided && (
        <div className="mt-1.5">
          <Chip tone="critical">{t("voidedBadge")}</Chip>
          <div className="mt-1 text-xs text-muted">
            {t("voidedBy", { name: row.voidedBy ?? "" })}: {row.voidReason}
          </div>
        </div>
      )}
      {!voided && row.status === "pending" && (
        <div className="mt-1.5">
          <Chip tone="warning">{t("statusPending")}</Chip>
          <div className="mt-1 text-xs text-muted">{t("notCounted")}</div>
        </div>
      )}
      {!voided && row.status === "rejected" && (
        <div className="mt-1.5">
          <Chip tone="critical">{t("statusRejected")}</Chip>
          <div className="mt-1 text-xs text-muted">
            {t("rejectedBy", { name: row.decidedBy ?? "" })}: {row.decisionNote}
          </div>
        </div>
      )}
      {row.status === "approved" && row.decidedBy && row.decidedBy !== row.recordedBy && (
        <div className="mt-1 text-xs text-muted">{t("approvedBy", { name: row.decidedBy })}</div>
      )}
    </>
  );

  return (
    <div data-tour="panel-list" className="@container">
      {/* Cards: wherever the table would not fit. Never on paper. */}
      <div className="grid gap-3 @2xl:grid-cols-2 @4xl:hidden print:hidden">
        {rows.map((row) => {
          const m = model(row);
          return (
            <Card
              key={row.id}
              className={`p-4 ${m.counted ? "" : "bg-surface-2/50"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="tabular text-xs font-medium text-muted">{row.entryNumber}</div>
                  <div className="text-xs text-faint">{formatDate(row.entryDate, locale)}</div>
                </div>
                <div className="text-right">
                  <div className={`tabular text-lg leading-tight font-semibold ${m.counted ? "" : "text-faint"}`}>
                    {formatMoney(m.amounts.line)}
                  </div>
                  <div className="tabular text-xs text-faint">
                    {row.qty} {row.unit} × {formatMoney(row.unitPrice)}
                  </div>
                  {taxLine(row) && <div className="tabular text-xs text-faint">{taxLine(row)}</div>}
                </div>
              </div>

              <div className={`mt-3 text-sm font-medium break-words ${m.voided ? "line-through" : ""}`}>
                {row.itemName}
              </div>
              <div className="font-mono text-xs break-words text-faint">
                {row.itemCode}
                {row.orderRef && ` · ${row.orderRef}`}
              </div>

              <div className="mt-3 text-sm break-words">
                <span className="text-xs text-faint">{t("for")} </span>
                {row.destination ?? "—"}
                {row.partnerName && <div className="text-xs text-muted">{row.partnerName}</div>}
              </div>

              {canSeeCost && row.unitCost !== null && (
                <div className="tabular mt-2 text-xs text-muted">
                  {t("totalCost")} {formatMoney(row.qty * row.unitCost)} · {t("margin")}{" "}
                  <span className={m.margin !== null && m.margin < 0 && m.counted ? "text-critical" : ""}>
                    {formatMoney(m.margin ?? 0)}
                  </span>
                </div>
              )}

              {row.notes && <div className="mt-2 text-xs break-words text-muted">{row.notes}</div>}
              {standing(row, m.voided)}

              <div className="mt-3 text-xs text-muted">
                {t("recordedBy")} {row.recordedBy}
                {row.pharmacist && ` · ${t("pharmacistName", { name: row.pharmacist })}`}
              </div>

              {hasActions && (m.mayDecide || m.mayVoid) && (
                <div className="mt-3 flex flex-col gap-2 border-t border-rule pt-3">
                  {m.mayDecide && (
                    <>
                      <form action={decidePanelEntryAction}>
                        <input type="hidden" name="entryId" value={row.id} />
                        <input type="hidden" name="decision" value="approve" />
                        {keep}
                        <button
                          type="submit"
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-accent/40 bg-accent-soft px-4 text-sm font-medium text-accent active:brightness-95"
                        >
                          {t("approve")}
                        </button>
                      </form>
                      <details>
                        <summary className="inline-flex min-h-11 w-full cursor-pointer list-none items-center justify-center rounded-lg border border-critical/40 px-4 text-sm font-medium text-critical [&::-webkit-details-marker]:hidden">
                          {t("reject")}
                        </summary>
                        <form action={decidePanelEntryAction} className="mt-2 flex flex-col gap-2">
                          <input type="hidden" name="entryId" value={row.id} />
                          <input type="hidden" name="decision" value="reject" />
                          {keep}
                          <label className="text-xs text-muted" htmlFor={`m-reject-${row.id}`}>
                            {t("rejectReason")}
                          </label>
                          <input
                            id={`m-reject-${row.id}`}
                            name="note"
                            required
                            maxLength={500}
                            autoComplete="off"
                            className={inputClass}
                          />
                          <button
                            type="submit"
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-critical px-4 text-sm font-medium text-white"
                          >
                            {t("rejectConfirm")}
                          </button>
                        </form>
                      </details>
                    </>
                  )}
                  {m.mayVoid && (
                    <details>
                      <summary className="inline-flex min-h-11 w-full cursor-pointer list-none items-center justify-center rounded-lg border border-rule px-4 text-sm font-medium text-muted [&::-webkit-details-marker]:hidden">
                        {t("void")}
                      </summary>
                      <form action={voidPanelEntryAction} className="mt-2 flex flex-col gap-2">
                        <input type="hidden" name="entryId" value={row.id} />
                        <input type="hidden" name="from" value={from} />
                        <input type="hidden" name="to" value={to} />
                        <label className="text-xs text-muted" htmlFor={`m-void-${row.id}`}>
                          {t("voidReason")}
                        </label>
                        <input
                          id={`m-void-${row.id}`}
                          name="reason"
                          required
                          maxLength={500}
                          autoComplete="off"
                          className={inputClass}
                        />
                        <p className="text-xs text-faint">{t("voidNote")}</p>
                        <button
                          type="submit"
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-critical px-4 text-sm font-medium text-white"
                        >
                          {t("voidConfirm")}
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* The table: wherever there is room for one, and always on paper. */}
      <Card className="hidden overflow-x-auto @4xl:block print:block print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <table className="report-table w-full min-w-[820px] text-sm print:min-w-0 print:[&_td]:py-1.5">
          <thead>
            <tr>
              <Th>{t("number")}</Th>
              <Th>{t("item")}</Th>
              <Th className="text-right">{t("qty")}</Th>
              <Th className="text-right">{t("lineTotal")}</Th>
              {canSeeCost && <Th className="text-right">{t("totalCost")}</Th>}
              {canSeeCost && <Th className="text-right">{t("margin")}</Th>}
              <Th>{t("parties")}</Th>
              <Th>{t("recordedBy")}</Th>
              {hasActions && <Th className="print:hidden">{null}</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const m = model(row);
              return (
                <tr
                  key={row.id}
                  className={`border-b border-rule/60 align-top last:border-0 ${m.counted ? "" : "text-faint"}`}
                >
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="tabular font-medium">{row.entryNumber}</div>
                    <div className="text-xs text-faint">{formatDate(row.entryDate, locale)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className={`font-medium ${m.voided ? "line-through" : ""}`}>{row.itemName}</div>
                    <div className="font-mono text-xs text-faint">
                      {row.itemCode}
                      {row.orderRef && ` · ${row.orderRef}`}
                    </div>
                    {row.notes && <div className="mt-1 text-xs text-muted">{row.notes}</div>}
                    {standing(row, m.voided)}
                  </td>
                  <td className="tabular px-3 py-3 text-right whitespace-nowrap">
                    {row.qty} {row.unit}
                  </td>
                  {/* The unit price sits under its total, so a line reads as one
                      sum and the table does not need a column for each half. */}
                  <td className="tabular px-3 py-3 text-right whitespace-nowrap">
                    <div className="font-medium">{formatMoney(m.amounts.line)}</div>
                    <div className="text-xs text-faint">
                      {formatMoney(row.unitPrice)} / {row.unit}
                    </div>
                    {taxLine(row) && <div className="text-xs text-faint">{taxLine(row)}</div>}
                  </td>
                  {canSeeCost && (
                    <td className="tabular px-3 py-3 text-right whitespace-nowrap text-muted">
                      {row.unitCost === null ? (
                        "—"
                      ) : (
                        <>
                          <div>{formatMoney(row.qty * row.unitCost)}</div>
                          <div className="text-xs text-faint">
                            {formatMoney(row.unitCost)} / {row.unit}
                          </div>
                        </>
                      )}
                    </td>
                  )}
                  {canSeeCost && (
                    <td
                      className={`tabular px-3 py-3 text-right whitespace-nowrap ${
                        m.margin !== null && m.margin < 0 && m.counted ? "text-critical" : ""
                      }`}
                    >
                      {m.margin === null ? "—" : formatMoney(m.margin)}
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <div>{row.destination ?? "—"}</div>
                    {row.partnerName && <div className="text-xs text-muted">{row.partnerName}</div>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div>{row.recordedBy}</div>
                    {row.pharmacist && (
                      <div className="text-xs text-muted">{t("pharmacistName", { name: row.pharmacist })}</div>
                    )}
                  </td>
                  {hasActions && (
                    <td className="px-3 py-3 text-right print:hidden">
                      <div className="flex flex-col items-end gap-1.5">
                        {m.mayDecide && (
                          <>
                            <form action={decidePanelEntryAction}>
                              <input type="hidden" name="entryId" value={row.id} />
                              <input type="hidden" name="decision" value="approve" />
                              {keep}
                              <button
                                type="submit"
                                className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-1 text-xs font-medium text-accent hover:brightness-95"
                              >
                                {t("approve")}
                              </button>
                            </form>
                            <details className="relative">
                              <summary className="cursor-pointer text-xs text-muted hover:text-critical">
                                {t("reject")}
                              </summary>
                              <form
                                action={decidePanelEntryAction}
                                className="absolute right-0 z-10 mt-2 flex w-64 flex-col gap-2 rounded-xl border border-rule bg-surface p-3 text-left shadow-[var(--shadow-pop)]"
                              >
                                <input type="hidden" name="entryId" value={row.id} />
                                <input type="hidden" name="decision" value="reject" />
                                {keep}
                                <label className="text-xs text-muted" htmlFor={`reject-${row.id}`}>
                                  {t("rejectReason")}
                                </label>
                                <input
                                  id={`reject-${row.id}`}
                                  name="note"
                                  required
                                  maxLength={500}
                                  autoComplete="off"
                                  className={`${inputSmall} w-full`}
                                />
                                <button
                                  type="submit"
                                  className="rounded-lg border border-critical/40 px-3 py-1.5 text-xs font-medium text-critical hover:bg-critical-soft"
                                >
                                  {t("rejectConfirm")}
                                </button>
                              </form>
                            </details>
                          </>
                        )}
                        {m.mayVoid && (
                          <details className="relative">
                            <summary className="cursor-pointer text-xs text-muted hover:text-critical">
                              {t("void")}
                            </summary>
                            <form
                              action={voidPanelEntryAction}
                              className="absolute right-0 z-10 mt-2 flex w-64 flex-col gap-2 rounded-xl border border-rule bg-surface p-3 text-left shadow-[var(--shadow-pop)]"
                            >
                              <input type="hidden" name="entryId" value={row.id} />
                              <input type="hidden" name="from" value={from} />
                              <input type="hidden" name="to" value={to} />
                              <label className="text-xs text-muted" htmlFor={`void-${row.id}`}>
                                {t("voidReason")}
                              </label>
                              <input
                                id={`void-${row.id}`}
                                name="reason"
                                required
                                maxLength={500}
                                autoComplete="off"
                                className={`${inputSmall} w-full`}
                              />
                              <p className="text-xs text-faint">{t("voidNote")}</p>
                              <button
                                type="submit"
                                className="rounded-lg border border-critical/40 px-3 py-1.5 text-xs font-medium text-critical hover:bg-critical-soft"
                              >
                                {t("voidConfirm")}
                              </button>
                            </form>
                          </details>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {truncated && (
        <p className="mt-3 rounded-xl border border-rule px-4 py-2.5 text-xs text-muted">
          {t("showingFirst", { count: rows.length })}
        </p>
      )}
    </div>
  );
}
