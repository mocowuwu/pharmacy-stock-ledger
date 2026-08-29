"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveSupplier, type SupplierFormState } from "./actions";
import { Alert, Card, Field, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export function SupplierForm() {
  const t = useTranslations();
  const [state, formAction] = useActionState<SupplierFormState, FormData>(
    saveSupplier,
    {},
  );
  const err = (field: string) =>
    state.fieldErrors?.[field] ? t(`errors.${state.fieldErrors[field]}`) : null;

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-medium">{t("suppliers.new")}</h2>
      <form action={formAction} className="flex flex-col gap-4">
        {state.formError && <Alert>{t(`errors.${state.formError}`)}</Alert>}
        {state.saved && <Alert tone="notice">{t("suppliers.created")}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("suppliers.name")} required error={err("name")}>
            <input name="name" required className={inputClass} />
          </Field>
          <Field label={t("suppliers.contactPerson")} error={err("contactPerson")}>
            <input name="contactPerson" className={inputClass} />
          </Field>
          <Field label={t("suppliers.phone")} error={err("phone")}>
            <input name="phone" inputMode="tel" className={inputClass} />
          </Field>
          <Field label={t("suppliers.email")} error={err("email")}>
            <input name="email" inputMode="email" className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("suppliers.address")} error={err("address")}>
              <textarea name="address" rows={2} className={inputClass} />
            </Field>
          </div>
        </div>

        <div>
          <SubmitButton pendingLabel={t("items.saving")}>{t("common.save")}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
