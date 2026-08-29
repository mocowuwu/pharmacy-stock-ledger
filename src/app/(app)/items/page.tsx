import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listCategories, listItems, type DrugClass } from "@/lib/dal/catalogue";
import { onHandByItem } from "@/lib/dal/stock";
import { DRUG_CLASSES } from "@/lib/catalogue/enums";
import { formatMoney } from "@/lib/format/money";
import {
  Card,
  Chip,
  DrugClassMark,
  EmptyState,
  PageHeader,
  inputClass,
} from "@/components/ui";

export default async function ItemsPage({ searchParams }: PageProps<"/items">) {
  const session = await requirePermission("items.view");
  const t = await getTranslations();
  const params = await searchParams;

  const str = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  const search = str("q");
  const categoryId = str("category");
  const drugClass = str("class");
  const status = str("status") || "active";

  const [items, categories] = await Promise.all([
    listItems({
      search,
      categoryId: categoryId || undefined,
      drugClass: (drugClass || undefined) as DrugClass | undefined,
      status: status as "active" | "archived" | "all",
    }),
    listCategories(),
  ]);

  // On-hand is derived from batch remainders, fetched for the whole page in one
  // query rather than one per row.
  const onHand = await onHandByItem(items.map((i) => i.id));

  const isFiltered = Boolean(search || categoryId || drugClass || status !== "active");

  return (
    <>
      <PageHeader
        title={t("items.title")}
        subtitle={t("items.subtitle")}
        actions={
          can(session.grant, "items.create") && (
            <Link
              href="/items/new"
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
            >
              {t("items.new")}
            </Link>
          )
        }
      />

      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={search}
          placeholder={t("items.searchPlaceholder")}
          className={`${inputClass} sm:max-w-xs`}
        />
        <select name="category" defaultValue={categoryId} className={`${inputClass} sm:w-auto`}>
          <option value="">{t("items.allCategories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select name="class" defaultValue={drugClass} className={`${inputClass} sm:w-auto`}>
          <option value="">{t("items.allClasses")}</option>
          {DRUG_CLASSES.map((value) => (
            <option key={value} value={value}>{t(`drugClass.${value}`)}</option>
          ))}
        </select>
        <select name="status" defaultValue={status} className={`${inputClass} sm:w-auto`}>
          <option value="active">{t("items.statusActive")}</option>
          <option value="archived">{t("items.statusArchived")}</option>
          <option value="all">{t("items.statusAll")}</option>
        </select>
        <button
          type="submit"
          className="rounded border border-rule px-4 py-2 text-sm text-muted hover:border-accent hover:text-accent"
        >
          {t("common.search")}
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title={isFiltered ? t("items.emptySearch") : t("items.empty")}
          body={isFiltered ? t("items.emptySearchBody") : t("items.emptyBody")}
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {t("items.resultCount", { count: items.length })}
          </p>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-rule bg-surface-2 text-left text-xs uppercase tracking-wide text-faint">
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t("items.code")}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t("items.genericName")}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t("items.drugClass")}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">{t("items.category")}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("stock.onHand")}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("items.defaultPrice")}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("items.reorderPoint")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-rule last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-muted">{item.code}</td>
                    <td className="px-3 py-2">
                      <Link href={`/items/${item.id}`} className="font-medium hover:text-accent">
                        {item.genericName}
                        {item.strength ? ` ${item.strength}` : ""}
                      </Link>
                      <div className="text-xs text-faint">
                        {[item.brandName, t(`dosageForm.${item.form}`), item.unit]
                          .filter(Boolean)
                          .join(" · ")}
                        {item.status === "archived" && (
                          <span className="ml-2">
                            <Chip>{t("items.statusArchived")}</Chip>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <DrugClassMark
                        drugClass={item.drugClass}
                        label={t(`drugClass.${item.drugClass}`)}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{item.categoryName ?? "—"}</td>
                    <td className="tabular px-3 py-2 text-right">
                      {(() => {
                        const qty = onHand.get(item.id) ?? 0;
                        // Out of stock and below the reorder point are the two
                        // states worth seeing without opening the item.
                        const tone =
                          qty === 0
                            ? "text-critical"
                            : qty <= item.reorderPoint
                              ? "text-warning"
                              : "";
                        return <span className={`font-medium ${tone}`}>{qty}</span>;
                      })()}
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {item.defaultPrice > 0 ? (
                        formatMoney(item.defaultPrice)
                      ) : (
                        <span className="text-faint">{t("items.noPrice")}</span>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-muted">
                      {item.reorderPoint}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
