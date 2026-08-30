import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { countableCategories } from "@/lib/dal/counts";
import { Alert, Card, Field, PageHeader, buttonPrimary, inputClass } from "@/components/ui";
import { createCount } from "../actions";

export default async function NewCountPage({
  searchParams,
}: PageProps<"/counts/new">) {
  await requirePermission("stock.count");
  const t = await getTranslations();
  const query = await searchParams;

  const categories = await countableCategories();

  return (
    <>
      <PageHeader title={t("counts.newTitle")} subtitle={t("counts.newSubtitle")} />

      {typeof query.error === "string" && (
        <Alert className="mb-4">{t(`errors.${query.error}`)}</Alert>
      )}

      <Alert tone="warning" className="mb-4">
        {t("counts.freezeWarning")}
      </Alert>

      <Card className="p-5">
        <form action={createCount} className="flex flex-col gap-4">
          <Field label={t("counts.name")} required>
            <input
              name="name"
              required
              placeholder={t("counts.namePlaceholder")}
              className={inputClass}
            />
          </Field>

          <Field label={t("counts.scope")} hint={t("counts.categoryHint")}>
            <select name="categoryId" defaultValue="" className={inputClass}>
              <option value="">{t("counts.wholePharmacy")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} — {t("counts.batchCount", { count: category.batches })}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("common.notes")}>
            <input name="notes" className={inputClass} />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className={buttonPrimary}
            >
              {t("counts.create")}
            </button>
            <Link href="/counts" className="text-sm text-muted hover:text-accent">
              {t("common.cancel")}
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
