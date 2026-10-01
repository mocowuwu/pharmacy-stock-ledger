import { getTranslations } from "next-intl/server";
import { listPanelEntriesAction } from "./actions";
import { PanelForm } from "./PanelForm";
import { PanelList } from "./PanelList";
import { PanelSummary } from "./PanelSummary";
import { RangePicker } from "@/app/(app)/reports/RangePicker";

export const metadata = { title: "Panel Apotek" };

export default async function PanelPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; itemCode?: string }>;
}) {
  const t = await getTranslations("panel");
  const params = await searchParams;
  const from = params.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const to = params.to || new Date().toISOString().split("T")[0];
  const itemCode = params.itemCode || "";

  const { entries, summary } = await listPanelEntriesAction({ from, to, itemCode });

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sidebar-ink">{t("title")}</h1>
          <p className="mt-1 text-sm text-sidebar-muted">{t("subtitle")}</p>
        </div>
        <RangePicker
          basePath="/panel"
          preset="custom"
          from={from}
          to={to}
          extra={{ itemCode }}
        />
      </header>

      <PanelSummary summary={summary} />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <PanelForm defaultDate={to} />
        </aside>
        <section>
          <PanelList entries={entries} />
        </section>
      </div>
    </div>
  );
}