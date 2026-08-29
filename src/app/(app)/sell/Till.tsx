"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { checkout, findForSale, type Candidate, type CheckoutState } from "./actions";
import { Alert, Card, Chip, inputBase, inputClass } from "@/components/ui";
import { formatMoney, parseMoney, applyRateBps, splitInclusiveTax } from "@/lib/format/money";
import { formatExpiry } from "@/lib/format/date";
import type { Locale } from "@/i18n/config";

type Line = {
  key: string;
  itemId: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  onHand: number;
  batches: Candidate["batches"];
  preferBatchId: string | null;
  overrideReason: string;
};

const PAYMENT_METHODS = [
  "tunai", "kartu_debit", "kartu_kredit", "qris", "transfer", "lainnya",
] as const;

export function Till({
  locale,
  canDiscount,
  canOverridePrice,
  canOverrideBatch,
  tax,
  scanning,
}: {
  locale: Locale;
  canDiscount: boolean;
  canOverridePrice: boolean;
  canOverrideBatch: boolean;
  tax: { enabled: boolean; rateBps: number; mode: "inclusive" | "exclusive" } | null;
  /**
   * Whether to mention scanning. The field itself stays either way -- it is
   * the item search, and a scanner just types into it very fast.
   */
  scanning: boolean;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("tunai");
  const [discountText, setDiscountText] = useState("");
  const [tenderedText, setTenderedText] = useState("");
  const [state, setState] = useState<CheckoutState>({});
  const [isPending, startTransition] = useTransition();

  const searchRef = useRef<HTMLInputElement>(null);

  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const discount = Math.min(Math.max(parseMoney(discountText) ?? 0, 0), subtotal);
  const net = subtotal - discount;

  let taxAmount = 0;
  let total = net;
  if (tax?.enabled) {
    if (tax.mode === "inclusive") {
      taxAmount = splitInclusiveTax(net, tax.rateBps).tax;
    } else {
      taxAmount = applyRateBps(net, tax.rateBps);
      total = net + taxAmount;
    }
  }

  const tendered = parseMoney(tenderedText);
  const change = tendered != null ? tendered - total : null;

  /**
   * A scanner sends the whole code then Enter, but a person typing a drug name
   * expects to see matches as they go. Both are supported: typing searches
   * after a short pause, Enter searches immediately and takes the first hit.
   */
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;

    const timer = setTimeout(() => {
      startTransition(async () => {
        setResults(await findForSale(text));
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function runSearch(text: string, addFirst = false) {
    startTransition(async () => {
      const found = await findForSale(text);
      setResults(found);
      if (addFirst && found.length > 0 && found[0].onHand > 0) {
        addToBasket(found[0]);
      }
    });
  }

  function addToBasket(candidate: Candidate) {
    setResults(null);
    setQuery("");
    searchRef.current?.focus();

    setLines((current) => {
      const existing = current.find((l) => l.itemId === candidate.id);
      if (existing) {
        return current.map((l) =>
          l.itemId === candidate.id
            ? { ...l, qty: Math.min(l.qty + 1, l.onHand) }
            : l,
        );
      }
      return [
        ...current,
        {
          key: `${candidate.id}-${Date.now()}`,
          itemId: candidate.id,
          name: candidate.name,
          unit: candidate.unit,
          qty: 1,
          unitPrice: candidate.price,
          onHand: candidate.onHand,
          batches: candidate.batches,
          preferBatchId: null,
          overrideReason: "",
        },
      ];
    });
  }

  const update = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Lines left at zero are simply not part of the sale; a line asking for more
  // than exists blocks it, so the refusal happens before the customer is
  // standing there rather than after.
  const sellableLines = lines.filter((l) => l.qty > 0);
  const overStocked = lines.some((l) => l.qty > l.onHand);
  const canCheckout = sellableLines.length > 0 && !overStocked && !isPending;

  function complete() {
    setState({});
    startTransition(async () => {
      const result = await checkout({
        lines: sellableLines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          preferBatchId: l.preferBatchId,
          overrideReason: l.overrideReason || null,
        })),
        paymentMethod: method,
        discount,
        tendered: method === "tunai" ? tendered : null,
      });
      setState(result);
      if (result.done) {
        setLines([]);
        setDiscountText("");
        setTenderedText("");
      }
    });
  }

  if (state.done) {
    return (
      <Card className="p-6">
        <p className="text-lg font-medium text-accent">
          {t("sell.completed", { number: state.done.saleNumber })}
        </p>
        <p className="tabular mt-2 text-3xl font-semibold">
          {formatMoney(state.done.total)}
        </p>
        {state.done.change != null && (
          <p className="tabular mt-1 text-muted">
            {t("sell.change")}: {formatMoney(state.done.change)}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/sales/${state.done.saleId}`}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
          >
            {t("sell.viewReceipt")}
          </Link>
          <button
            type="button"
            onClick={() => {
              setState({});
              searchRef.current?.focus();
            }}
            className="rounded border border-rule px-4 py-2 text-sm text-muted hover:border-accent hover:text-accent"
          >
            {t("sell.newSale")}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4">
        {/* Search sits outside any form: a scanner ends every read with Enter. */}
        <Card className="p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">{t(scanning ? "sell.search" : "sell.searchNoScan")}</span>
            <input
              ref={searchRef}
              value={query}
              autoFocus
              autoComplete="off"
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                // Cleared here rather than in the effect: clearing state
                // synchronously inside an effect causes a cascading render.
                if (next.trim().length < 2) setResults(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                runSearch(query, true);
              }}
              className={inputClass}
            />
            <span className="text-xs text-faint">{t(scanning ? "sell.searchHint" : "sell.searchHintNoScan")}</span>
          </label>

          {results && results.length === 0 && (
            <p className="mt-3 text-sm text-muted">{t("sell.noResults")}</p>
          )}

          {results && results.length > 0 && (
            <ul className="mt-3 divide-y divide-rule">
              {results.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    disabled={candidate.onHand === 0}
                    onClick={() => addToBasket(candidate)}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left disabled:opacity-60"
                  >
                    <span>
                      <span className="font-medium">{candidate.name}</span>
                      <span className="ml-2 font-mono text-xs text-faint">
                        {candidate.code}
                      </span>
                      <span className="block text-xs text-muted">
                        {candidate.onHand > 0
                          ? t("sell.available", { qty: `${candidate.onHand} ${candidate.unit}` })
                          : candidate.expiredUnits > 0
                            ? t("sell.expiredOnly", { qty: candidate.expiredUnits })
                            : t("sell.outOfStock")}
                      </span>
                    </span>
                    <span className="tabular whitespace-nowrap font-medium">
                      {formatMoney(candidate.price)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 font-medium">{t("sell.basket")}</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-muted">{t("sell.emptyBasket")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule">
              {lines.map((line) => (
                <li
                  key={line.key}
                  className={`py-3 ${line.qty === 0 ? "opacity-50" : ""}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{line.name}</div>
                      <div className="text-xs text-muted">
                        {t("sell.available", { qty: `${line.onHand} ${line.unit}` })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/*
                        The quantity is allowed to reach zero, and the field is
                        shown empty when it does. Clamping to a minimum of one
                        on every keystroke meant the field could never be
                        cleared: getting from 1 to 10 required typing the 0
                        first and then deleting the 1.

                        Nothing is clamped to available stock while typing
                        either -- a mid-word clamp rewrites what the cashier is
                        still in the middle of entering. Too many is flagged
                        below instead, and checkout is blocked.
                      */}
                      <div className="flex items-stretch">
                        <button
                          type="button"
                          aria-label={t("sell.decrease")}
                          onClick={() =>
                            update(line.key, { qty: Math.max(0, line.qty - 1) })
                          }
                          className="rounded-l border border-r-0 border-rule px-2.5 text-muted hover:border-accent hover:text-accent"
                        >
                          &minus;
                        </button>
                        <input
                          inputMode="numeric"
                          aria-label={t("sell.qty")}
                          value={line.qty === 0 ? "" : line.qty}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/gu, "");
                            update(line.key, { qty: digits === "" ? 0 : Number(digits) });
                          }}
                          className={`${inputBase} tabular w-24 rounded-none px-2 text-center`}
                        />
                        <button
                          type="button"
                          aria-label={t("sell.increase")}
                          onClick={() => update(line.key, { qty: line.qty + 1 })}
                          className="rounded-r border border-l-0 border-rule px-2.5 text-muted hover:border-accent hover:text-accent"
                        >
                          +
                        </button>
                      </div>
                      <input
                        inputMode="numeric"
                        disabled={!canOverridePrice}
                        defaultValue={formatMoney(line.unitPrice, { bare: true })}
                        onBlur={(e) => {
                          const parsed = parseMoney(e.target.value);
                          if (parsed != null) update(line.key, { unitPrice: parsed });
                        }}
                        className={`${inputBase} tabular w-28 text-right`}
                      />
                      <span className="tabular w-28 text-right font-medium">
                        {formatMoney(line.qty * line.unitPrice)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLines((c) => c.filter((l) => l.key !== line.key))
                        }
                        className="text-xs text-muted hover:text-critical"
                      >
                        {t("sell.remove")}
                      </button>
                    </div>
                  </div>

                  {line.qty > line.onHand && (
                    <p className="mt-1 text-xs text-critical">
                      {t("sell.exceedsStock", { qty: line.onHand, unit: line.unit })}
                    </p>
                  )}

                  {/* Which lot is about to leave, so the cashier can check it
                      against the box in their hand. */}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {canOverrideBatch && line.batches.length > 1 ? (
                      <select
                        value={line.preferBatchId ?? ""}
                        onChange={(e) =>
                          update(line.key, { preferBatchId: e.target.value || null })
                        }
                        className={`${inputBase} w-auto py-1 text-xs`}
                      >
                        <option value="">{t("sell.fefoDefault")}</option>
                        {line.batches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.lotNumber ?? "—"} · {formatExpiry(b.expiryDate, locale)} ({b.qty})
                          </option>
                        ))}
                      </select>
                    ) : (
                      line.batches[0] && (
                        <Chip>
                          {line.batches[0].lotNumber ?? "—"} ·{" "}
                          {formatExpiry(line.batches[0].expiryDate, locale)}
                        </Chip>
                      )
                    )}

                    {line.preferBatchId &&
                      line.preferBatchId !== line.batches[0]?.id && (
                        <input
                          value={line.overrideReason}
                          onChange={(e) =>
                            update(line.key, { overrideReason: e.target.value })
                          }
                          placeholder={t("sell.overrideReason")}
                          className={`${inputBase} flex-1 py-1 text-xs`}
                        />
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t("sell.subtotal")}</dt>
              <dd className="tabular">{formatMoney(subtotal)}</dd>
            </div>

            {canDiscount && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">{t("sell.discount")}</dt>
                <dd>
                  <input
                    inputMode="numeric"
                    value={discountText}
                    onChange={(e) => setDiscountText(e.target.value)}
                    className={`${inputBase} tabular w-28 py-1 text-right`}
                  />
                </dd>
              </div>
            )}

            {tax?.enabled && (
              <div className="flex justify-between">
                <dt className="text-muted">
                  {t("sell.tax")} {(tax.rateBps / 100).toFixed(0)}%
                </dt>
                <dd className="tabular">{formatMoney(taxAmount)}</dd>
              </div>
            )}

            <div className="mt-1 flex justify-between border-t border-rule pt-2 text-lg font-semibold">
              <dt>{t("sell.total")}</dt>
              <dd className="tabular">{formatMoney(total)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">
              {t("sell.paymentMethod")}
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              className={inputClass}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{t(`paymentMethod.${m}`)}</option>
              ))}
            </select>
          </label>

          {method === "tunai" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted">{t("sell.tendered")}</span>
              <input
                inputMode="numeric"
                value={tenderedText}
                onChange={(e) => setTenderedText(e.target.value)}
                className={`${inputClass} tabular text-right`}
              />
              {change != null && change >= 0 && (
                <span className="tabular text-sm text-accent">
                  {t("sell.change")}: {formatMoney(change)}
                </span>
              )}
            </label>
          )}

          {state.error && (
            <Alert>
              {state.error === "insufficient_stock" && state.detail
                ? t("errors.not_enough", {
                    item: String(state.detail.item ?? ""),
                    short: String(state.detail.short ?? ""),
                  })
                : t(`errors.${state.error}`)}
            </Alert>
          )}

          <button
            type="button"
            onClick={complete}
            disabled={!canCheckout}
            className="rounded bg-accent px-4 py-3 font-medium text-accent-contrast disabled:opacity-60"
          >
            {isPending ? t("sell.processing") : t("sell.checkout")}
          </button>
        </Card>
      </div>
    </div>
  );
}
