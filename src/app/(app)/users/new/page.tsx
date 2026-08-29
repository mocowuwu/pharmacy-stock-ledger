import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { PageHeader } from "@/components/ui";
import { NewUserForm } from "./NewUserForm";

export default async function NewUserPage() {
  await requirePermission("users.manage");
  const t = await getTranslations();

  return (
    <>
      <PageHeader title={t("users.newTitle")} subtitle={t("users.subtitle")} />
      <NewUserForm />
    </>
  );
}
