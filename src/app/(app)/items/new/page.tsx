import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listCategories } from "@/lib/dal/catalogue";
import { PageHeader, Alert } from "@/components/ui";
import { ItemForm } from "../ItemForm";

export default async function NewItemPage({ searchParams }: PageProps<"/items/new">) {
  const session = await requirePermission("items.create");
  const t = await getTranslations();
  const params = await searchParams;
  const str = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  const categories = await listCategories();

  return (
    <>
      <PageHeader title={t("items.new")} subtitle={t("items.subtitle")} />

      {/* Shown after "save and add another", so a run of data entry confirms
          each item without leaving the form. */}
      {str("added") && (
        <div className="mb-4">
          <Alert tone="notice">{t("items.created", { name: str("added") })}</Alert>
        </div>
      )}

      <ItemForm
        isEdit={false}
        canSetPrice={can(session.grant, "items.set_price")}
        categories={categories}
        values={{
          categoryId: str("category") || null,
          form: str("form") || undefined,
          drugClass: str("drugClass") || undefined,
          unit: str("unit") || undefined,
        }}
      />
    </>
  );
}
