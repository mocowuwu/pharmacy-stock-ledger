import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listItems, listSuppliers } from "@/lib/dal/catalogue";
import { listTodaysReceipts } from "@/lib/dal/stock";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatExpiry, today } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { ReceiveForm } from "./ReceiveForm";

export default async function ReceivePage() {
  const session = await requirePermission("batches.receive");
  const t = await getTranslations();
  const locale = session.user.locale;

  const [items, suppliers, receipts] = await Promise.all([
    listItems({ status: "active" }),
    listSuppliers(),
    listTodaysReceipts(),
  ]);

  const options = items.map((item) => ({
    id: item.id,
    code: item.code,
    label: `${item.genericName}${item.strength ? ` ${item.strength}` : ""}`,
    unit: item.unit,
    packSize: item.packSize,
  }));

  return (
    <>
      <PageHeader title={t("receive.title")} subtitle={t("receive.subtitle")} />

      {items.length === 0 ? (
        <EmptyState title={t("items.empty")} body={t("receive.needItems")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <ReceiveForm items={options} suppliers={suppliers} today={today()} />

          <div>
            <h2 className="mb-3 font-medium">{t("receive.todaysReceipts")}</h2>
            {receipts.length === 0 ? (
              <p className="text-sm text-muted">{t("receive.noReceipts")}</p>
            ) : (
              <Card className="divide-y divide-rule">
                {receipts.map((r) => (
                  <div key={r.batchId} className="px-4 py-3 text-sm">
                    <div className="font-medium">
                      {r.genericName}
                      {r.strength ? ` ${r.strength}` : ""}
                    </div>
                    <div className="tabular mt-0.5 text-xs text-muted">
                      {r.qtyReceived} {r.unit} · {formatExpiry(r.expiryDate, locale)}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-faint">
                      {r.lotNumber ?? t("stock.legacyLot")} · {r.supplierName}
                      {r.unitCost > 0 ? ` · ${formatMoney(r.unitCost)}` : ""}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
