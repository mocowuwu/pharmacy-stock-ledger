import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listSuppliers } from "@/lib/dal/catalogue";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import { SupplierForm } from "./SupplierForm";

export default async function SuppliersPage() {
  const session = await requirePermission("items.view");
  const t = await getTranslations();
  const suppliers = await listSuppliers(true);

  return (
    <>
      <PageHeader title={t("suppliers.title")} subtitle={t("suppliers.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div>
          {suppliers.length === 0 ? (
            <EmptyState title={t("suppliers.empty")} body={t("suppliers.emptyBody")} />
          ) : (
            <Card className="divide-y divide-rule">
              {suppliers.map((supplier) => (
                <div key={supplier.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{supplier.name}</span>
                    {supplier.isSystem && <Chip tone="accent">{t("suppliers.system")}</Chip>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {supplier.isSystem
                      ? t("suppliers.systemHint")
                      : [supplier.contactPerson, supplier.phone, supplier.email]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        {can(session.grant, "suppliers.manage") && <SupplierForm />}
      </div>
    </>
  );
}
