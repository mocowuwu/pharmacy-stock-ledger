"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addItemBarcode, deleteItemBarcode, type ItemFormState } from "./actions";
import { Alert, Card, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

type Barcode = {
  id: string;
  barcode: string;
  packSize: number | null;
  note: string | null;
};

/**
 * Barcodes are a child list, not a field: one item routinely carries several --
 * a different code per pack size, a local box and an imported one.
 *
 * Only the product code is stored here. A GS1 scan also carries lot and expiry,
 * but those describe a batch and are read at receiving.
 */
export function BarcodeSection({
  itemId,
  barcodes,
  canEdit,
}: {
  itemId: string;
  barcodes: Barcode[];
  canEdit: boolean;
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState<ItemFormState, FormData>(addItemBarcode, {});

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-medium">{t("items.barcodes")}</h2>

      {barcodes.length === 0 ? (
        <p className="text-sm text-muted">{t("items.noBarcodes")}</p>
      ) : (
        <ul className="mb-4 divide-y divide-rule">
          {barcodes.map((code) => (
            <li key={code.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <span className="font-mono text-sm">{code.barcode}</span>
                <span className="ml-2 text-xs text-faint">
                  {code.packSize ? t("items.packOf", { count: code.packSize }) : ""}
                  {code.note ? ` · ${code.note}` : ""}
                </span>
              </div>
              {canEdit && (
                <form action={deleteItemBarcode}>
                  <input type="hidden" name="barcodeId" value={code.id} />
                  <input type="hidden" name="itemId" value={itemId} />
                  <button
                    type="submit"
                    className="text-xs text-muted hover:text-critical"
                  >
                    {t("items.remove")}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="itemId" value={itemId} />
          <input
            name="barcode"
            placeholder={t("items.barcodeValue")}
            // A USB scanner types the code and presses Enter, so this field
            // just needs to accept fast input and submit on return.
            autoComplete="off"
            className={`${inputClass} font-mono sm:max-w-xs`}
          />
          <input
            name="packSize"
            inputMode="numeric"
            placeholder={t("items.packSize")}
            className={`${inputClass} tabular sm:w-40`}
          />
          <SubmitButton variant="secondary">{t("items.addBarcode")}</SubmitButton>
          {state.fieldErrors?.barcode && (
            <div className="w-full">
              <Alert>{t(`errors.${state.fieldErrors.barcode}`)}</Alert>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
