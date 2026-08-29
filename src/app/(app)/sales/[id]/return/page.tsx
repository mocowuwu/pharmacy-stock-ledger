import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { returnableLines } from "@/lib/dal/sales";
import { getSettings } from "@/lib/dal/settings";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { ReturnForm } from "./ReturnForm";

export default async function ReturnPage({ params }: PageProps<"/sales/[id]/return">) {
  const session = await requirePermission("sales.return");
  const t = await getTranslations();
  const { id } = await params;

  const data = await returnableLines(id);
  if (!data) notFound();

  const settings = await getSettings();
  const { sale, lines } = data;

  // What was actually paid per rupiah of list price, so the preview in the
  // form matches what the server will compute from the sale itself.
  const refundRatio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
  const anythingLeft = lines.some((line) => line.returnable > 0);

  return (
    <>
      <PageHeader
        title={t("returns.title")}
        subtitle={t("returns.subtitle", { number: sale.saleNumber })}
      />

      {sale.status === "voided" ? (
        <Alert tone="warning">{t("errors.sale_voided")}</Alert>
      ) : anythingLeft ? (
        <ReturnForm
          saleId={sale.id}
          saleNumber={sale.saleNumber}
          locale={session.user.locale}
          lines={lines}
          refundRatio={refundRatio}
          restockAllowed={settings.allowReturnRestock}
        />
      ) : (
        <Card className="p-6">
          <EmptyState title={t("returns.nothingReturnable")} />
        </Card>
      )}

      <Link
        href={`/sales/${sale.id}`}
        className="mt-6 inline-block text-sm text-muted hover:text-accent"
      >
        {t("returns.backToSale")}
      </Link>
    </>
  );
}
