"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/format/money";

interface PanelSummaryProps {
  summary: {
    totalEntries: number;
    totalQty: number;
    totalCost: number;
    totalRevenue: number;
    totalMargin: number;
  };
}

export function PanelSummary({ summary }: PanelSummaryProps) {
  const t = useTranslations("panel");

  const cards = [
    { label: t("totalEntries"), value: summary.totalEntries.toLocaleString(), tone: "neutral" },
    { label: t("totalQty"), value: summary.totalQty.toLocaleString(), tone: "neutral" },
    { label: t("totalCost"), value: formatMoney(summary.totalCost), tone: "cost" },
    { label: t("totalRevenue"), value: formatMoney(summary.totalRevenue), tone: "revenue" },
    { label: t("totalMargin"), value: formatMoney(summary.totalMargin), tone: summary.totalMargin >= 0 ? "positive" : "negative" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-xl p-4 border ${
            card.tone === "cost"
              ? "bg-critical-soft/10 border-critical/20"
              : card.tone === "revenue"
              ? "bg-positive-soft/10 border-positive/20"
              : card.tone === "positive"
              ? "bg-positive-soft/10 border-positive/20"
              : card.tone === "negative"
              ? "bg-critical-soft/10 border-critical/20"
              : "bg-sidebar-hover/30 border-sidebar-rule"
          }`}
        >
          <p className="text-xs font-medium text-sidebar-muted">{card.label}</p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${
              card.tone === "cost"
                ? "text-critical-ink"
                : card.tone === "revenue"
                ? "text-positive-ink"
                : card.tone === "positive"
                ? "text-positive-ink"
                : card.tone === "negative"
                ? "text-critical-ink"
                : "text-sidebar-ink"
            }`}
          >
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}