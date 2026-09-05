"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { checkout, findForSale, type Candidate, type CheckoutState } from "./actions";
import {
  Alert,
  Card,
  Chip,
  SummaryRow,
  buttonPrimary,
  buttonPrimaryLarge,
  buttonSecondary,
  inputBase,
  inputClass,
  inputSmall,
} from "@/components/ui";
import { ScanButton } from "@/components/BarcodeScanner";
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

/** The search field's id, so its label can point at it without wrapping it. */
const SEARCH_FIELD_ID = "till-search";

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
            className={buttonPrimary}
          >
            {t("sell.viewReceipt")}
          </Link>
          <button
            type="button"
            onClick={() => {
              setState({});
              searchRef.current?.focus();
            }}
            className={buttonSecondary}
          >
            {t("sell.newSale")}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* `min-w-0` on both columns: a grid item's default minimum is its
          content, so without it the basket row's fixed-width controls widen the
          column past the screen and the whole page scrolls sideways. */}
      <div className="flex min-w-0 flex-col gap-4">
        {/* Search sits outside any form: a scanner ends every read with Enter. */}
        <Card className="p-4">
          {/*
            The label points at the field by id rather than wrapping it.
            Wrapping put the scan button inside the label, and a tap on a label
            is forwarded to the control it labels: on a phone the button did
            nothing and the keyboard opened instead.
          */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={SEARCH_FIELD_ID} className="text-sm font-medium text-muted">
              {t(scanning ? "sell.search" : "sell.searchNoScan")}
            </label>
            {/* Stacked on a phone: sharing the row leaves the search box too
                narrow to read what has been typed into it. */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={SEARCH_FIELD_ID}
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
              {/*
                The camera is the phone's scanner. It hands its payload to the
                same search the keyboard feeds, so a GS1 code read off the box
                resolves exactly as a USB scanner's would.
              */}
              {scanning && (
                <ScanButton
                  className="w-full shrink-0 py-3 sm:w-auto sm:py-2.5"
                  onScan={(code) => {
                    setQuery(code);
                    runSearch(code, true);
                  }}
                />
              )}
            </div>
            <span className="text-xs text-faint">{t(scanning ? "sell.searchHint" : "sell.searchHintNoScan")}</span>
          </div>

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
                    className="flex w-full items-center justify-between gap-3 py-3 text-left disabled:opacity-60"
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
                  {/* Two rows on a phone, one on a desktop. The controls keep
                      their order either way, so the cashier's hand goes to the
                      same place on both. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{line.name}</div>
                      <div className="text-xs text-muted">
                        {t("sell.available", { qty: `${line.onHand} ${line.unit}` })}
                      </div>
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
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
                          className="rounded-l border border-r-0 border-rule px-3.5 text-muted hover:border-accent hover:text-accent sm:px-2.5"
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
                          className={`${inputBase} tabular w-16 rounded-none px-2 text-center sm:w-24`}
                        />
                        <button
                          type="button"
                          aria-label={t("sell.increase")}
                          onClick={() => update(line.key, { qty: line.qty + 1 })}
                          className="rounded-r border border-l-0 border-rule px-3.5 text-muted hover:border-accent hover:text-accent sm:px-2.5"
                        >
                          +
                        </button>
                      </div>
                      {/* The unit price drops to its own line on a phone. It is
                          an override, used rarely and by few; the quantity and
                          the line total are what the cashier looks at, and they
                          keep the first line to themselves. */}
                      <label className="order-last flex w-full items-center gap-2 sm:order-none sm:w-28">
                        {/* Named on a phone, where it stands alone on its own
                            line and a bare box of digits means nothing. */}
                        <span className="text-xs text-muted sm:hidden">
                          {t("common.price")}
                        </span>
                        <input
                          inputMode="numeric"
                          aria-label={t("common.price")}
                          disabled={!canOverridePrice}
                          defaultValue={formatMoney(line.unitPrice, { bare: true })}
                          onBlur={(e) => {
                            const parsed = parseMoney(e.target.value);
                            if (parsed != null) update(line.key, { unitPrice: parsed });
                          }}
                          className={`${inputBase} tabular w-full min-w-0 text-right`}
                        />
                      </label>
                      <span className="tabular ml-auto shrink-0 text-right font-medium sm:ml-0 sm:w-28">
                        {formatMoney(line.qty * line.unitPrice)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLines((c) => c.filter((l) => l.key !== line.key))
                        }
                        className="shrink-0 px-1 py-2 text-xs text-muted hover:text-critical"
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
                        className={`${inputSmall} w-auto`}
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
                          className={`${inputSmall} flex-1`}
                        />
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Genuinely floating -- it sits sticky over the basket while scrolling
          -- so it's the one panel that gets the glass (Surface 2) treatment
          instead of the app's usual opaque cards. */}
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <Card glass className="p-4">
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <SummaryRow label={t("sell.subtotal")} value={formatMoney(subtotal)} />
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
              <div>
                <SummaryRow
                  label={`${t("sell.tax")} ${(tax.rateBps / 100).toFixed(0)}%`}
                  value={formatMoney(taxAmount)}
                />
              </div>
            )}

            <div className="mt-1 border-t border-rule pt-2">
              <SummaryRow label={t("sell.total")} value={formatMoney(total)} strong />
            </div>
          </dl>
        </Card>

        <Card glass className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">
              {t("sell.paymentMethod")}
            </span>
            {/* A segmented toggle rather than a dropdown: the payment method
                is picked once per sale and read at a glance by whoever is
                watching the till, not typed -- the accent-soft selected state
                is the one place in the summary panel color is doing more than
                labelling, per the reference's own selected-state pattern. */}
            <div
              role="radiogroup"
              aria-label={t("sell.paymentMethod")}
              className="grid grid-cols-2 gap-2"
            >
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={`rounded-full border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    method === m
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-rule text-muted hover:border-accent/40 hover:text-accent"
                  }`}
                >
                  {t(`paymentMethod.${m}`)}
                </button>
              ))}
            </div>
          </div>

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
            className={buttonPrimaryLarge}
          >
            {isPending ? t("sell.processing") : t("sell.checkout")}
          </button>
        </Card>
      </div>
    </div>
  );
}
