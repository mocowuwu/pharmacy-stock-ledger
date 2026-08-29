"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { resolveScan, submitReceipt, type ReceiveState, type ScanState } from "./actions";
import { Alert, Card, Field, inputBase, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

type ItemOption = {
  id: string;
  code: string;
  label: string;
  unit: string;
  packSize: number | null;
};

const MONTHS = ["01","02","03","04","05","06","07","08","09","10","11","12"];

export function ReceiveForm({
  items,
  suppliers,
  today,
}: {
  items: ItemOption[];
  suppliers: Array<{ id: string; name: string; isSystem: boolean }>;
  today: string;
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState<ReceiveState, FormData>(submitReceipt, {});

  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [itemId, setItemId] = useState("");
  const [lot, setLot] = useState("");
  const [exactExpiry, setExactExpiry] = useState("");
  const [quantityUnit, setQuantityUnit] = useState<"unit" | "pack">("unit");
  const [isPending, startTransition] = useTransition();

  const scanRef = useRef<HTMLInputElement>(null);
  const lotRef = useRef<HTMLInputElement>(null);
  const handledSave = useRef<ReceiveState["saved"]>(undefined);

  /**
   * Clears the carried-over fields after a successful save.
   *
   * Without this the lot number stays on screen, and the next box gets booked
   * in under the previous box's lot -- which is not a cosmetic slip: it puts
   * the wrong expiry against real stock and the ledger would faithfully record
   * the mistake. Focus returns to the scanner for the next item.
   */
  useEffect(() => {
    if (state.saved && state.saved !== handledSave.current) {
      handledSave.current = state.saved;
      setItemId("");
      setLot("");
      setExactExpiry("");
      setQuantityUnit("unit");
      setScan({ status: "idle" });
      scanRef.current?.focus();
    }
  }, [state.saved]);

  const selected = items.find((i) => i.id === itemId) ?? null;
  const err = (field: string) =>
    state.fieldErrors?.[field] ? t(`errors.${state.fieldErrors[field]}`) : null;

  async function runScan(raw: string) {
    if (!raw.trim()) return;
    const result = await resolveScan(raw);
    setScan(result);
    if (result.itemId) setItemId(result.itemId);
    if (result.lotNumber) setLot(result.lotNumber);
    if (result.expiryDate) setExactExpiry(result.expiryDate);
    if (scanRef.current) scanRef.current.value = "";
    // A GS1 code fills in the lot; a plain EAN-13 does not, so the cursor goes
    // where the operator still has work to do.
    if (!result.lotNumber) lotRef.current?.focus();
  }

  const scanNow = () =>
    startTransition(() => {
      void runScan(scanRef.current?.value ?? "");
    });

  return (
    <div className="flex flex-col gap-5">
      {/*
        The scan box sits OUTSIDE the form deliberately. A scanner ends every
        read with Enter, and an Enter inside a form submits it -- which would
        book in a half-filled delivery the moment someone scanned a box. Out
        here, Enter can only ever mean "look this up".
      */}
      <Card className="p-5">
        <Field label={t("receive.scan")} hint={t("receive.scanHint")}>
          <div className="flex gap-2">
            <input
              ref={scanRef}
              type="text"
              autoComplete="off"
              autoFocus
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                scanNow();
              }}
              disabled={isPending}
              className={`${inputClass} font-mono`}
            />
            <button
              type="button"
              onClick={scanNow}
              disabled={isPending}
              className="rounded border border-rule px-4 text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-60"
            >
              {t("common.search")}
            </button>
          </div>
        </Field>

        {scan.status === "found" && (
          <p className="mt-2 text-sm text-accent">
            {t("receive.scanFound", { name: scan.itemLabel ?? "" })}
          </p>
        )}
        {scan.status === "unknown" && (
          <p className="mt-2 text-sm text-muted">{t("receive.scanUnknown")}</p>
        )}
        {scan.status === "unreadable" && (
          <p className="mt-2 text-sm text-critical">{t("receive.scanUnreadable")}</p>
        )}
      </Card>

      <form action={formAction} className="flex flex-col gap-5">
        {state.formError && <Alert>{t(`errors.${state.formError}`)}</Alert>}
        {state.saved && (
          <Alert tone="notice">
            {t("receive.saved", {
              qty: state.saved.qty,
              unit: state.saved.unit,
              name: state.saved.name,
            })}
          </Alert>
        )}

        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={t("receive.item")} required error={err("itemId")}>
                <select
                  name="itemId"
                  required
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">{t("receive.chooseItem")}</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label={t("receive.supplier")} required error={err("supplierId")}>
              <select name="supplierId" required className={inputClass}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>

            <Field label={t("receive.receivedDate")} error={err("receivedDate")}>
              <input
                type="date"
                name="receivedDate"
                defaultValue={today}
                className={inputClass}
              />
            </Field>

            <Field label={t("receive.lot")} hint={t("receive.lotHint")} error={err("lotNumber")}>
              <input
                ref={lotRef}
                name="lotNumber"
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                autoComplete="off"
                className={`${inputClass} font-mono`}
              />
            </Field>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-muted">
                {t("receive.expiry")} <span className="text-critical">*</span>
              </span>
              {exactExpiry ? (
                <>
                  <input type="hidden" name="expiryDate" value={exactExpiry} />
                  <div className="flex items-center gap-2">
                    <span className="tabular rounded border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
                      {exactExpiry}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExactExpiry("")}
                      className="text-xs text-muted hover:text-accent"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex gap-2">
                  <select name="expiryMonth" className={`${inputBase} w-28`} defaultValue="">
                    <option value="" disabled>{t("receive.expiryMonth")}</option>
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    name="expiryYear"
                    inputMode="numeric"
                    placeholder={t("receive.expiryYear")}
                    maxLength={4}
                    className={`${inputBase} tabular w-28`}
                  />
                </div>
              )}
              {err("expiryMonth") ? (
                <span className="mt-1 block text-xs text-critical">{err("expiryMonth")}</span>
              ) : (
                <span className="mt-1 block text-xs text-faint">{t("receive.expiryHint")}</span>
              )}
            </div>

            <Field label={t("receive.quantity")} required error={err("quantity")}>
              <div className="flex gap-2">
                <input
                  name="quantity"
                  inputMode="numeric"
                  required
                  className={`${inputClass} tabular`}
                />
                <select
                  name="quantityUnit"
                  value={quantityUnit}
                  onChange={(e) => setQuantityUnit(e.target.value as "unit" | "pack")}
                  className={`${inputBase} w-40`}
                >
                  <option value="unit">{selected?.unit ?? t("receive.inUnits")}</option>
                  <option value="pack" disabled={!selected?.packSize}>
                    {t("receive.inPacks")}
                    {selected?.packSize ? ` (${selected.packSize})` : ""}
                  </option>
                </select>
              </div>
            </Field>

            <input type="hidden" name="packSize" value={selected?.packSize ?? ""} />
            <input type="hidden" name="unitLabel" value={selected?.unit ?? ""} />
            <input type="hidden" name="itemLabel" value={selected?.label ?? ""} />
            {scan.status === "unknown" && scan.barcode && (
              <input type="hidden" name="pendingBarcode" value={scan.barcode} />
            )}

            <Field
              label={t("receive.unitCost")}
              hint={quantityUnit === "pack" ? t("receive.costPerPack") : t("receive.costPerUnit")}
              error={err("unitCost")}
            >
              <input name="unitCost" inputMode="numeric" className={`${inputClass} tabular`} />
            </Field>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="isOpening" className="h-4 w-4" />
                <span className="text-sm text-muted">{t("receive.opening")}</span>
              </label>
              <span className="pl-6 text-xs text-faint">{t("receive.openingHint")}</span>

              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" name="isLegacy" className="h-4 w-4" />
                <span className="text-sm text-muted">{t("receive.legacy")}</span>
              </label>
              <span className="pl-6 text-xs text-faint">{t("receive.legacyHint")}</span>
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel={t("items.saving")}>{t("receive.submit")}</SubmitButton>
          {selected && quantityUnit === "pack" && selected.packSize && (
            <span className="text-xs text-faint">
              1 {t("receive.inPacks")} = {selected.packSize} {selected.unit}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
