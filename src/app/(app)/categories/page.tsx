import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listCategories } from "@/lib/dal/catalogue";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { CategoryForm } from "./CategoryForm";

export default async function CategoriesPage() {
  const session = await requirePermission("items.view");
  const t = await getTranslations();
  const categories = await listCategories();

  return (
    <>
      <PageHeader title={t("categories.title")} subtitle={t("categories.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div>
          {categories.length === 0 ? (
            <EmptyState title={t("categories.empty")} body={t("categories.emptyBody")} />
          ) : (
            <Card className="divide-y divide-rule">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <span className="font-medium">{category.name}</span>
                  <Link
                    href={`/items?category=${category.id}`}
                    className="tabular text-sm text-muted hover:text-accent"
                  >
                    {t("categories.itemCount", { count: category.itemCount })}
                  </Link>
                </div>
              ))}
            </Card>
          )}
        </div>

        {can(session.grant, "items.create") && <CategoryForm />}
      </div>
    </>
  );
}
