"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Field, buttonPrimaryLarge, inputClass } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/format/money";
import { saleTotals } from "@/lib/stock/totals";
import { createPanelEntryAction, type PanelFormState } from "./actions";

type Hit = { id: string; code: string; name: string; unit: string; drugClass: string };

type Values = {
  entryDate: string;
  orderRef: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: string;
  unitCost: string;
  unitPrice: string;
  partnerName: string;
  destination: string;
  notes: string;
  pharmacistId: string;
};

/**
 * What stays after an entry is saved. One surat pesanan lists several items for
 * the same doctor from the same PBF, so the order, the date, who it is for and
 * who ordered it carry over; the item and the money start again.
 */
const ITEM_FIELDS = {
  itemCode: "",
  itemName: "",
  unit: "",
  qty: "",
  unitCost: "",
  unitPrice: "",
  notes: "",
} as const;

type TaxChoices = {
  /** Whether the pharmacy charges PPN at all. Without it the form has no tax field. */
  enabled: boolean;
  mode: "inclusive" | "exclusive";
  /** Whether a new order starts with PPN ticked. */
  defaultOn: boolean;
  rates: { rateBps: number; effectiveFrom: string; effectiveTo: string | null }[];
};

export function PanelForm({
  today,
  pharmacists,
  defaultPharmacistId,
  tax,
  needsApproval,
}: {
  /** Today in the pharmacy's timezone, from the server. The browser's clock may differ. */
  today: string;
  pharmacists: { id: string; fullName: string }[];
  defaultPharmacistId: string;
  tax: TaxChoices;
  /** An order from this account will wait for approval before it counts. */
  needsApproval: boolean;
}) {
  const t = useTranslations();
  const listId = useId();
  const [state, formAction, pending] = useActionState<PanelFormState, FormData>(
    createPanelEntryAction,
    {},
  );
  // Starts from the pharmacy's default and is the person's to change per order.
  // It stays as they left it between items: one order, one decision about PPN.
  const [taxed, setTaxed] = useState(tax.enabled && tax.defaultOn);

  // Pressing Save at the bottom of a long form on a phone leaves the outcome --
  // saved, or what was wrong -- at the top, out of sight, and a button that
  // appears to do nothing gets pressed twice. So the message is brought into view.
  const outcome = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.saved || state.error) {
      outcome.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [state]);

  const [values, setValues] = useState<Values>({
    entryDate: today,
    orderRef: "",
    partnerName: "",
    destination: "",
    pharmacistId: defaultPharmacistId,
    ...ITEM_FIELDS,
  });

  // A saved entry clears the item and the money, once per saved number. Adjusting
  // state while rendering, guarded by the number, rather than in an effect: the
  // form would otherwise paint the old values for a frame after saving.
  const [clearedFor, setClearedFor] = useState<string | undefined>();
  if (state.saved && state.saved !== clearedFor) {
    setClearedFor(state.saved);
    setValues((current) => ({ ...current, ...ITEM_FIELDS }));
  }

  // The "saved" banner is about the last submission, so it goes away on the next
  // edit, and when the page comes back from voiding an entry: the form's state
  // outlives that redirect, and two contradictory notices side by side read as a
  // fault.
  const [dismissed, setDismissed] = useState<string | undefined>();
  const params = useSearchParams();
  const marker = params.get("voided") ?? params.get("error");
  const [seenMarker, setSeenMarker] = useState(marker);
  if (marker !== seenMarker) {
    setSeenMarker(marker);
    setDismissed(state.saved);
  }

  const bind = (name: keyof Values) => ({
    name,
    value: values[name],
    onChange: (event: { target: { value: string } }) => {
      setDismissed(state.saved);
      setValues((current) => ({ ...current, [name]: event.target.value }));
    },
  });

  // The catalogue picker. It only ever fills the same three fields the
  // pharmacist can type into, so a code the catalogue does not know still works.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const term = query.trim();
  const searching = term.length >= 2;

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/panel/search-items?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { items?: Hit[] };
        setHits(data.items ?? []);
        setFailed(false);
        setActive(-1);
      } catch (error) {
        // A superseded request is cancelled, not failed.
        if ((error as Error).name === "AbortError") return;
        setHits([]);
        setFailed(true);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const shown = searching ? hits : [];

  const pick = (hit: Hit) => {
    setDismissed(state.saved);
    setValues((current) => ({ ...current, itemCode: hit.code, itemName: hit.name, unit: hit.unit }));
    setQuery("");
    setOpen(false);
  };

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "ArrowDown" && shown.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % shown.length);
    } else if (event.key === "ArrowUp" && shown.length > 0) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? shown.length - 1 : index - 1));
    } else if (event.key === "Enter" && open && active >= 0 && shown[active]) {
      // Enter picks the highlighted hit; it must not also submit the form.
      event.preventDefault();
      pick(shown[active]);
    }
  };

  const qty = parseMoney(values.qty);
  const price = parseMoney(values.unitPrice);
  const lineTotal = qty !== null && price !== null ? qty * price : null;

  // The rate that applies is the one in force on the order's own day -- the
  // server picks it the same way -- so the preview follows the date field.
  const rate = tax.enabled
    ? tax.rates.find(
        (r) =>
          r.effectiveFrom <= values.entryDate &&
          (r.effectiveTo === null || r.effectiveTo >= values.entryDate),
      )
    : undefined;
  const preview =
    taxed && rate && qty !== null && price !== null
      ? saleTotals([{ qty, unitPrice: price, taxExempt: false }], 0, {
          mode: tax.mode,
          rateBps: rate.rateBps,
        })
      : null;
  const ratePercent = rate
    ? `${(rate.rateBps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`
    : "";

  const heading = "text-xs font-semibold tracking-[0.08em] text-accent uppercase";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">{t("panel.newEntry")}</h2>
        <p className="mt-1 text-xs text-muted">{t("panel.newEntryHint")}</p>
        {needsApproval && <p className="mt-1.5 text-xs text-warning-ink">{t("panel.needsApprovalHint")}</p>}
      </div>

      <div ref={outcome} className="flex scroll-mt-20 flex-col gap-3 empty:hidden">
        {state.error && <Alert>{t(`errors.${state.error}`)}</Alert>}
        {state.saved && state.saved !== dismissed && (
          <Alert tone={state.pending ? "warning" : "notice"}>
            {t(state.pending ? "panel.savedPending" : "panel.saved", { number: state.saved })}
          </Alert>
        )}
      </div>

      {/* The order: filled in once, then carried over to every item on it. */}
      <section className="flex flex-col gap-4">
        <h3 className={heading}>{t("panel.sectionOrder")}</h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Field label={t("panel.entryDate")} required>
            <input type="date" {...bind("entryDate")} max={today} required className={inputClass} />
          </Field>
          <Field label={t("panel.orderRef")} required>
            <input
              {...bind("orderRef")}
              required
              maxLength={60}
              autoComplete="off"
              placeholder={t("panel.orderRefPlaceholder")}
              className={inputClass}
            />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-faint">{t("panel.orderRefHint")}</p>
        <Field label={t("panel.destination")} required>
          <input
            {...bind("destination")}
            required
            maxLength={120}
            autoComplete="off"
            placeholder={t("panel.destinationPlaceholder")}
            className={inputClass}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className={heading}>{t("panel.sectionItem")}</h3>
        <div className="relative">
          <label htmlFor={`${listId}-search`} className="text-sm font-medium text-foreground/90">
            {t("panel.itemSearch")}
          </label>
          <input
            id={`${listId}-search`}
            type="text"
            role="combobox"
            aria-expanded={open && shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            value={query}
            placeholder={t("panel.itemSearchPlaceholder")}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onSearchKey}
            className={`${inputClass} mt-2`}
          />
          <p className="mt-2 text-xs text-faint">{t("panel.itemSearchHint")}</p>

          {open && searching && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-rule bg-surface p-1 shadow-[var(--shadow-pop)]"
            >
              {failed ? (
                <li className="px-3 py-3 text-sm text-critical">{t("panel.searchFailed")}</li>
              ) : shown.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted">{t("panel.noResults")}</li>
              ) : (
                shown.map((hit, index) => (
                  <li
                    key={hit.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    // Mouse-down, not click, and default prevented: the input must
                    // keep focus, or its blur closes the list before a tap lands.
                    // Taller than a mouse needs: this is pressed with a thumb.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(hit);
                    }}
                    className={`min-h-11 cursor-pointer rounded-lg px-3 py-2.5 text-sm ${
                      index === active ? "bg-accent-soft" : "active:bg-surface-2 hover:bg-surface-2"
                    }`}
                  >
                    <span className="font-medium">{hit.name}</span>
                    <span className="ml-2 font-mono text-xs text-faint">{hit.code}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("panel.itemCode")} required>
            <input
              {...bind("itemCode")}
              required
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={t("panel.itemCodePlaceholder")}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label={t("panel.unit")} required>
            <input
              {...bind("unit")}
              required
              maxLength={20}
              autoComplete="off"
              placeholder={t("panel.unitPlaceholder")}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label={t("panel.itemName")} required>
          <input
            {...bind("itemName")}
            required
            maxLength={200}
            autoComplete="off"
            placeholder={t("panel.itemNamePlaceholder")}
            className={inputClass}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className={heading}>{t("panel.sectionPrice")}</h3>
        {/* Quantity on a row of its own on a phone, the two prices side by side
            below it: three columns of money in 300px left every label wrapping
            to three lines. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
          <div className="col-span-2 sm:col-span-1 xl:col-span-2">
            <Field label={t("panel.qty")} required>
              <input {...bind("qty")} required inputMode="numeric" autoComplete="off" className={`${inputClass} tabular`} />
            </Field>
          </div>
          <Field label={t("panel.unitCost")} required>
            <input {...bind("unitCost")} required inputMode="numeric" autoComplete="off" className={`${inputClass} tabular`} />
          </Field>
          <Field label={t("panel.unitPrice")} required>
            <input {...bind("unitPrice")} required inputMode="numeric" autoComplete="off" className={`${inputClass} tabular`} />
          </Field>
        </div>

        {tax.enabled && (
          <div>
            {/* The whole row is the target, not just the box: 16px is not a thing to hit. */}
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg py-1 text-sm">
              <input
                type="checkbox"
                name="taxed"
                checked={taxed}
                onChange={(event) => {
                  setDismissed(state.saved);
                  setTaxed(event.target.checked);
                }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium">
                  {rate ? t("panel.taxCheckbox", { rate: ratePercent }) : t("panel.taxCheckboxPlain")}
                </span>
                <span className="mt-0.5 block text-xs text-faint">
                  {tax.mode === "exclusive" ? t("panel.taxOnTopNote") : t("panel.taxInsideNote")}
                </span>
              </span>
            </label>
            {taxed && !rate && <p className="mt-1 text-xs text-critical">{t("panel.taxNoRate")}</p>}
          </div>
        )}

        {lineTotal !== null && (
          <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
            {t("panel.lineTotal")}:{" "}
            <span className="tabular font-semibold text-foreground">{formatMoney(lineTotal)}</span>
            {preview && (
              <span className="mt-0.5 block text-xs text-faint">
                {tax.mode === "exclusive"
                  ? t("panel.taxPreviewTop", {
                      tax: formatMoney(preview.taxAmount),
                      total: formatMoney(preview.total),
                    })
                  : t("panel.taxPreviewInside", { tax: formatMoney(preview.taxAmount) })}
              </span>
            )}
          </p>
        )}
      </section>

      {/* Optional, and so out of the way until wanted. A closed <details> still
          submits what is inside it, so the pharmacist default is not lost. */}
      <details className="group rounded-xl border border-rule">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-medium">{t("panel.moreDetails")}</span>
            <span className="block text-xs text-faint">{t("panel.moreDetailsHint")}</span>
          </span>
          <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="flex flex-col gap-4 px-3.5 pt-1 pb-4">
          <Field label={t("panel.partnerName")}>
            <input
              {...bind("partnerName")}
              maxLength={120}
              autoComplete="off"
              placeholder={t("panel.partnerNamePlaceholder")}
              className={inputClass}
            />
          </Field>

          <Field label={t("panel.pharmacist")}>
            <select {...bind("pharmacistId")} className={inputClass}>
              <option value="">{t("panel.pharmacistNone")}</option>
              {pharmacists.map((pharmacist) => (
                <option key={pharmacist.id} value={pharmacist.id}>
                  {pharmacist.fullName}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("panel.notes")}>
            <textarea {...bind("notes")} rows={2} maxLength={500} className={`${inputClass} resize-none`} />
          </Field>
        </div>
      </details>

      {/* Stuck to the bottom of the screen on a phone, so Save is always under the
          thumb however far down the form has been scrolled; an ordinary button
          from `xl`, where the whole form fits. The negative margins cancel the
          card's own padding so the bar sits flush with its edges. */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 rounded-b-2xl border-t border-rule bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-5 sm:-mb-5 sm:px-5 xl:static xl:m-0 xl:border-0 xl:bg-transparent xl:p-0 xl:backdrop-blur-none">
        <button type="submit" disabled={pending} className={`${buttonPrimaryLarge} disabled:opacity-60`}>
          {pending ? t("panel.saving") : t("panel.save")}
        </button>
      </div>
    </form>
  );
}
