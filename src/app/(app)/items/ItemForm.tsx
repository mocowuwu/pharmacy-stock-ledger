"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { saveItem, type ItemFormState } from "./actions";
import { DOSAGE_FORMS, DRUG_CLASSES } from "@/lib/catalogue/enums";
import { formatMoney } from "@/lib/format/money";
import { Alert, Field, Card, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export type ItemFormValues = {
  id?: string;
  code?: string | null;
  genericName?: string;
  brandName?: string | null;
  form?: string;
  strength?: string | null;
  unit?: string;
  packSize?: number | null;
  categoryId?: string | null;
  drugClass?: string;
  nie?: string | null;
  isTaxExempt?: boolean;
  reorderPoint?: number;
  reorderQty?: number | null;
  defaultPrice?: number;
  minShelfLifeDays?: number | null;
  notes?: string | null;
};

export function ItemForm({
  values,
  categories,
  canSetPrice,
  isEdit,
  drugClasses,
}: {
  values: ItemFormValues;
  categories: Array<{ id: string; name: string }>;
  canSetPrice: boolean;
  isEdit: boolean;
  /**
   * The classes offered. Narrower than the full list while the narkotika
   * module is off -- but an item already carrying a hidden class keeps it in
   * the list below, or editing that item would silently reclassify it.
   */
  drugClasses: readonly string[];
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState<ItemFormState, FormData>(saveItem, {});

  // Whatever the item already is stays selectable, whatever the module says.
  const offeredClasses = DRUG_CLASSES.filter(
    (value) => drugClasses.includes(value) || value === values.drugClass,
  );

  const err = (field: string) =>
    state.fieldErrors?.[field] ? t(`errors.${state.fieldErrors[field]}`) : null;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      {state.formError && <Alert>{t(`errors.${state.formError}`)}</Alert>}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t("items.genericName")} required error={err("genericName")}>
              <input
                name="genericName"
                defaultValue={values.genericName ?? ""}
                required
                autoFocus
                className={inputClass}
              />
            </Field>
          </div>

          <Field label={t("items.brandName")} error={err("brandName")}>
            <input
              name="brandName"
              defaultValue={values.brandName ?? ""}
              className={inputClass}
            />
          </Field>

          <Field
            label={t("items.strength")}
            hint={t("items.strengthHint")}
            error={err("strength")}
          >
            <input
              name="strength"
              defaultValue={values.strength ?? ""}
              className={inputClass}
            />
          </Field>

          <Field label={t("items.form")} required error={err("form")}>
            <select name="form" defaultValue={values.form ?? "tablet"} className={inputClass}>
              {DOSAGE_FORMS.map((value) => (
                <option key={value} value={value}>
                  {t(`dosageForm.${value}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t("items.unit")}
            hint={t("items.unitHint")}
            required
            error={err("unit")}
          >
            <input
              name="unit"
              defaultValue={values.unit ?? ""}
              required
              className={inputClass}
            />
          </Field>

          <Field label={t("items.drugClass")} required error={err("drugClass")}>
            <select
              name="drugClass"
              defaultValue={values.drugClass ?? "bebas"}
              className={inputClass}
            >
              {offeredClasses.map((value) => (
                <option key={value} value={value}>
                  {t(`drugClass.${value}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("items.category")} error={err("categoryId")}>
            <select
              name="categoryId"
              defaultValue={values.categoryId ?? ""}
              className={inputClass}
            >
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t("items.packSize")}
            hint={t("items.packSizeHint")}
            error={err("packSize")}
          >
            <input
              name="packSize"
              inputMode="numeric"
              defaultValue={values.packSize ?? ""}
              className={`${inputClass} tabular`}
            />
          </Field>

          <Field label={t("items.nie")} hint={t("items.nieHint")} error={err("nie")}>
            <input name="nie" defaultValue={values.nie ?? ""} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("items.defaultPrice")} error={err("defaultPrice")}>
            <input
              name="defaultPrice"
              inputMode="numeric"
              disabled={!canSetPrice}
              defaultValue={
                values.defaultPrice ? formatMoney(values.defaultPrice, { bare: true }) : ""
              }
              className={`${inputClass} tabular`}
            />
          </Field>

          <Field
            label={t("items.reorderPoint")}
            hint={t("items.reorderPointHint")}
            error={err("reorderPoint")}
          >
            <input
              name="reorderPoint"
              inputMode="numeric"
              defaultValue={values.reorderPoint ?? 0}
              className={`${inputClass} tabular`}
            />
          </Field>

          <Field label={t("items.reorderQty")} error={err("reorderQty")}>
            <input
              name="reorderQty"
              inputMode="numeric"
              defaultValue={values.reorderQty ?? ""}
              className={`${inputClass} tabular`}
            />
          </Field>

          <Field
            label={t("items.minShelfLife")}
            hint={t("items.minShelfLifeHint")}
            error={err("minShelfLifeDays")}
          >
            <input
              name="minShelfLifeDays"
              inputMode="numeric"
              defaultValue={values.minShelfLifeDays ?? ""}
              className={`${inputClass} tabular`}
            />
          </Field>

          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              name="isTaxExempt"
              defaultChecked={values.isTaxExempt ?? false}
              className="h-4 w-4"
            />
            <span className="text-sm text-muted">{t("items.taxExempt")}</span>
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("items.code")} hint={t("items.codeHint")} error={err("code")}>
            <input
              name="code"
              defaultValue={values.code ?? ""}
              className={`${inputClass} font-mono`}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("items.notes")} error={err("notes")}>
              <textarea
                name="notes"
                rows={2}
                defaultValue={values.notes ?? ""}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton name="intent" value="save" pendingLabel={t("items.saving")}>
          {t("items.save")}
        </SubmitButton>
        {!isEdit && (
          <SubmitButton
            name="intent"
            value="save_and_new"
            variant="secondary"
            pendingLabel={t("items.saving")}
          >
            {t("items.saveAndNew")}
          </SubmitButton>
        )}
        <Link href="/items" className="text-sm text-muted hover:text-accent">
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
