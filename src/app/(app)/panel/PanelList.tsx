"use client";

import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { formatMoney } from "@/lib/format/money";

interface PanelEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  unitCost: number;
  unitPrice: number;
  partnerName: string | null;
  destination: string | null;
  notes: string | null;
  recordedBy: string;
  pharmacistId: string | null;
  createdAt: Date;
}

interface PanelListProps {
  entries: PanelEntry[];
}

export function PanelList({ entries }: PanelListProps) {
  const t = useTranslations("panel");

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-sidebar-rule bg-sidebar-hover/30 p-12 text-center">
        <p className="text-sidebar-muted">{t("empty")}</p>
        <p className="mt-1 text-sm text-sidebar-muted/70">{t("emptyBody")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sidebar-rule overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-sidebar-hover/50 border-b border-sidebar-rule">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("entryNumber")}
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("entryDate")}
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("item")}
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("qty")}
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("unitCost")}
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("unitPrice")}
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("margin")}
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-sidebar-muted uppercase tracking-wider">
                {t("partnerDestination")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sidebar-rule">
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-sidebar-hover/30 transition-colors">
                <td className="px-3 py-2.5 font-mono text-xs text-sidebar-ink">
                  {entry.entryNumber}
                </td>
                <td className="px-3 py-2.5 text-sidebar-ink whitespace-nowrap">
                  {format(new Date(entry.entryDate), "dd MMM yyyy")}
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-sidebar-ink">{entry.itemName}</div>
                  <div className="text-xs text-sidebar-muted font-mono">{entry.itemCode}</div>
                </td>
                <td className="px-3 py-2.5 text-right text-sidebar-ink tabular-nums">
                  {entry.qty.toLocaleString()} {entry.unit}
                </td>
                <td className="px-3 py-2.5 text-right text-sidebar-muted tabular-nums">
                  {formatMoney(entry.unitCost)}
                </td>
                <td className="px-3 py-2.5 text-right text-sidebar-ink tabular-nums font-medium">
                  {formatMoney(entry.unitPrice)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {entry.unitPrice > entry.unitCost ? (
                    <span className="text-positive-ink">
                      +{formatMoney(entry.unitPrice - entry.unitCost)}
                    </span>
                  ) : entry.unitPrice < entry.unitCost ? (
                    <span className="text-critical-ink">
                      {formatMoney(entry.unitPrice - entry.unitCost)}
                    </span>
                  ) : (
                    <span className="text-sidebar-muted">{formatMoney(0)}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-sidebar-muted">
                  <div className="truncate max-w-[180px]">
                    {entry.partnerName || "—"}
                  </div>
                  {entry.destination && (
                    <div className="text-xs truncate max-w-[180px]">{entry.destination}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entries.length >= 100 && (
        <div className="px-3 py-2 border-t border-sidebar-rule bg-sidebar-hover/30 text-xs text-sidebar-muted text-center">
          {t("showingFirst100")}
        </div>
      )}
    </div>
  );
}