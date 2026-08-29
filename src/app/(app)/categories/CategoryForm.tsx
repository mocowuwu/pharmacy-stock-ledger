"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addCategory, type CategoryFormState } from "./actions";
import { Alert, Card, Field, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export function CategoryForm() {
  const t = useTranslations();
  const [state, formAction] = useActionState<CategoryFormState, FormData>(
    addCategory,
    {},
  );

  return (
    <Card className="p-5">
      <form action={formAction} className="flex flex-col gap-4">
        {state.error && <Alert>{t(`errors.${state.error}`)}</Alert>}
        {state.saved && <Alert tone="notice">{t("categories.created")}</Alert>}
        <Field label={t("categories.name")} required>
          <input name="name" required className={inputClass} />
        </Field>
        <div>
          <SubmitButton pendingLabel={t("items.saving")}>
            {t("categories.add")}
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
