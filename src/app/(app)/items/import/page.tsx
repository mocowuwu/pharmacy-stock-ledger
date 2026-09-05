import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { PageHeader } from "@/components/ui";
import { ImportForm } from "./ImportForm";

export default async function ItemsImportPage() {
  await requirePermission("items.import");
  const t = await getTranslations();

  return (
    <>
      <PageHeader title={t("itemsImport.title")} subtitle={t("itemsImport.subtitle")} />
      <ImportForm />
    </>
  );
}
