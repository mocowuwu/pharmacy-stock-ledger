"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Card, Field, buttonPrimary, inputBase, inputClass } from "@/components/ui";
import { formatExpiry } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { PAYMENT_METHODS } from "@/lib/catalogue/enums";
import { submitReturn, type ReturnState } from "./actions";

export type ReturnableLine = {
  id: string;
  itemName: string;
  strength: string | null;
  unit: string;
  lotNumber: string | null;
  expiryDate: string;
  unitPrice: number;
  qty: number;
  alreadyReturned: number;
  returnable: number;
};

/**
 * Choosing what comes back.
 *
 * The refund shown here is what the customer actually paid, not the list
 * price: it carries the sale's discount and tax through, so a half-price sale
 * refunds half price. The server recomputes it from the sale rather than
 * trusting this number.
 */
export function ReturnForm({
  saleId,
  saleNumber,
  locale,
  lines,
  refundRatio,
  restockAllowed,
}: {
  saleId: string;
  saleNumber: string;
  locale: "id" | "en";
  lines: ReturnableLine[];
  /** The sale's total over its subtotal, so the preview matches the server. */
  refundRatio: number;
  restockAllowed: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<ReturnState, FormData>(
    submitReturn,
    {},
  );
  const [qtys, setQtys] = useState<Record<string, number>>({});

  const set = (id: string, qty: number, max: number) =>
    setQtys((prev) => ({ ...prev, [id]: Math.min(Math.max(qty, 0), max) }));

  const refundFor = (line: ReturnableLine) =>
    Math.round((qtys[line.id] ?? 0) * line.unitPrice * refundRatio);

  const refundTotal = lines.reduce((sum, line) => sum + refundFor(line), 0);
  const chosen = lines.filter((line) => (qtys[line.id] ?? 0) > 0);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="saleId" value={saleId} />
      {chosen.map((line) => (
        <input
          key={line.id}
          type="hidden"
          name="line"
          value={`${line.id}:${qtys[line.id]}`}
        />
      ))}

      {state.formError && (
        <Alert>
          {t(`errors.${state.formError}`, {
            item: String(state.detail?.item ?? ""),
            remaining: String(state.detail?.remaining ?? ""),
          })}
        </Alert>
      )}

      {/* The rule the whole screen exists to enforce, said before anything is
          chosen rather than after the fact. */}
      <Alert tone={restockAllowed ? "notice" : "warning"}>
        {restockAllowed ? t("returns.restockNotice") : t("returns.quarantineNotice")}
      </Alert>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-rule text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                {t("sell.item")}
              </th>
              <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                {t("returns.sold")}
              </th>
              <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                {t("returns.returnable")}
              </th>
              <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                {t("returns.returning")}
              </th>
              <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                {t("returns.refund")}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const qty = qtys[line.id] ?? 0;
              return (
                <tr key={line.id} className="border-b border-rule/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {line.itemName}
                      {line.strength ? ` ${line.strength}` : ""}
                    </div>
                    <div className="font-mono text-xs text-faint">
                      {line.lotNumber ?? "—"} · {formatExpiry(line.expiryDate, locale)}
                    </div>
                  </td>
                  <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                    {line.qty} {line.unit}
                    {line.alreadyReturned > 0 && (
                      <div className="text-xs text-faint">
                        {t("returns.alreadyReturned")}: {line.alreadyReturned}
                      </div>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{line.returnable}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-stretch justify-center">
                      <button
                        type="button"
                        aria-label={t("sell.decrease")}
                        disabled={line.returnable === 0}
                        onClick={() => set(line.id, qty - 1, line.returnable)}
                        className="rounded-l border border-r-0 border-rule px-2.5 text-muted hover:border-accent hover:text-accent disabled:opacity-40"
                      >
                        −
                      </button>
                      <input
                        inputMode="numeric"
                        aria-label={t("returns.returning")}
                        disabled={line.returnable === 0}
                        value={qty === 0 ? "" : qty}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/gu, "");
                          set(line.id, digits === "" ? 0 : Number(digits), line.returnable);
                        }}
                        className={`${inputBase} tabular w-20 rounded-none px-2 text-center`}
                      />
                      <button
                        type="button"
                        aria-label={t("sell.increase")}
                        disabled={line.returnable === 0}
                        onClick={() => set(line.id, qty + 1, line.returnable)}
                        className="rounded-r border border-l-0 border-rule px-2.5 text-muted hover:border-accent hover:text-accent disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                    {qty > 0 ? formatMoney(refundFor(line)) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-baseline justify-between border-b border-rule pb-3">
          <span className="font-medium">{t("returns.refundTotal")}</span>
          <span className="tabular text-2xl font-semibold">
            {formatMoney(refundTotal)}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("returns.refundMethod")} required>
            <select name="refundMethod" defaultValue="tunai" className={inputClass}>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(`paymentMethod.${method}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("returns.reason")} required>
            <input
              name="reason"
              required
              placeholder={t("returns.reasonPlaceholder")}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label={t("returns.notes")}>
          <input name="notes" className={inputClass} />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || chosen.length === 0}
            className={buttonPrimary}
          >
            {pending ? t("common.loading") : t("returns.submit")}
          </button>
          <Link
            href={`/sales/${saleId}`}
            className="text-sm text-muted hover:text-accent"
          >
            {t("common.cancel")}
          </Link>
          <span className="text-xs text-faint">{saleNumber}</span>
        </div>
      </Card>
    </form>
  );
}
