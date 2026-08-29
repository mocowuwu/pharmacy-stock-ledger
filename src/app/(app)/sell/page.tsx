import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { settings, taxRates } from "@/db/schema";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui";
import { today } from "@/lib/format/date";
import { Till } from "./Till";

export default async function SellPage() {
  const session = await requirePermission("sales.create");
  const t = await getTranslations();
  const db = await getDb();

  // The till previews tax for the customer; the server recomputes it
  // authoritatively at checkout, so the two can never disagree on the receipt.
  const [config] = await db.select().from(settings).where(eq(settings.id, 1));
  let tax: { enabled: boolean; rateBps: number; mode: "inclusive" | "exclusive" } | null =
    null;

  if (config?.taxEnabled) {
    const on = today();
    const [rate] = await db
      .select()
      .from(taxRates)
      .where(
        and(
          lte(taxRates.effectiveFrom, on),
          or(isNull(taxRates.effectiveTo), gte(taxRates.effectiveTo, on)),
        ),
      )
      .orderBy(desc(taxRates.effectiveFrom))
      .limit(1);
    if (rate) tax = { enabled: true, rateBps: rate.rateBps, mode: config.taxMode };
  }

  return (
    <>
      <PageHeader title={t("sell.title")} subtitle={t("sell.subtitle")} />
      <Till
        locale={session.user.locale}
        canDiscount={can(session.grant, "sales.discount")}
        canOverridePrice={can(session.grant, "sales.price_override")}
        canOverrideBatch={can(session.grant, "sales.batch_override")}
        tax={tax}
        scanning={config?.barcodesEnabled ?? true}
      />
    </>
  );
}
