import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { getItem, listCategories } from "@/lib/dal/catalogue";
import { Alert, PageHeader, buttonSecondarySmall } from "@/components/ui";
import { DRUG_CLASSES } from "@/lib/catalogue/enums";
import { MODULE_DRUG_CLASSES, moduleFlags } from "@/lib/catalogue/modules";
import { getSettings } from "@/lib/dal/settings";
import { ItemForm } from "../ItemForm";
import { BarcodeSection } from "../BarcodeSection";
import { StockPanel } from "../StockPanel";
import { changeItemStatus } from "../actions";

export default async function ItemDetailPage({ params, searchParams }: PageProps<"/items/[id]">) {
  const session = await requirePermission("items.view");
  const t = await getTranslations();
  const { id } = await params;
  const query = await searchParams;

  const item = await getItem(id);
  if (!item) notFound();

  const categories = await listCategories();

  // Classes whose module is switched off are not offered on the form. Nothing
  // already saved is affected -- the form adds the item's own class back.
  const settings = await getSettings();
  const flags = moduleFlags(settings);
  const gated = new Set(
    Object.entries(MODULE_DRUG_CLASSES)
      .filter(([module]) => !flags[module as keyof typeof flags])
      .flatMap(([, classes]) => classes ?? []),
  );
  const drugClasses = DRUG_CLASSES.filter((value) => !gated.has(value));
  const canEdit = can(session.grant, "items.edit");

  return (
    <>
      <PageHeader
        title={`${item.genericName}${item.strength ? ` ${item.strength}` : ""}`}
        subtitle={item.code}
        actions={
          can(session.grant, "items.archive") && (
            <form action={changeItemStatus}>
              <input type="hidden" name="id" value={item.id} />
              <input
                type="hidden"
                name="status"
                value={item.status === "active" ? "archived" : "active"}
              />
              <button
                type="submit"
                className={buttonSecondarySmall}
              >
                {item.status === "active" ? t("items.archive") : t("items.restore")}
              </button>
            </form>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {query.saved && <Alert tone="notice">{t("items.updated")}</Alert>}
        {query.error === "not_allowed" && <Alert>{t("errors.not_allowed")}</Alert>}
        {item.status === "archived" && (
          <Alert tone="warning">{t("items.archivedNotice")}</Alert>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {canEdit ? (
          <ItemForm
            drugClasses={drugClasses}
            isEdit
            canSetPrice={can(session.grant, "items.set_price")}
            categories={categories}
            values={item}
          />
        ) : (
          <p className="text-sm text-muted">{t("errors.not_allowed")}</p>
        )}

        <StockPanel
          itemId={item.id}
          unit={item.unit}
          locale={session.user.locale}
          canSeeCost={can(session.grant, "reports.financial")}
        />

        <BarcodeSection itemId={item.id} barcodes={item.barcodes} canEdit={canEdit} />

        <Link href="/items" className="text-sm text-muted hover:text-accent">
          {t("items.backToList")}
        </Link>
      </div>
    </>
  );
}
