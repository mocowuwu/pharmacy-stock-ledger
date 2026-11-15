"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { buttonPrimary, buttonSecondary } from "@/components/ui";
import { saveDashboard } from "./actions";

type Row = { key: string; on: boolean; allowed: boolean };

/**
 * Arranges one account's widgets: a switch and two arrows per row. Arrows
 * rather than drag-and-drop, because the pharmacy's staff do this on a phone
 * and a thumb-sized button works where a drag handle does not.
 *
 * The order submitted is the order on screen, as repeated `widget` fields.
 */
export function DashboardEditor({ userId, rows: initial }: { userId: string; rows: Row[] }) {
  const t = useTranslations("dashboardEditor");
  const [rows, setRows] = useState(initial);

  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const next = [...current];
      const to = index + by;
      if (to < 0 || to >= next.length) return current;
      [next[index], next[to]] = [next[to]!, next[index]!];
      return next;
    });

  const toggle = (index: number) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, on: !row.on } : row)));

  return (
    <form action={saveDashboard} className="flex flex-col gap-4">
      <input type="hidden" name="userId" value={userId} />
      {rows.filter((row) => row.on).map((row) => (
        <input key={row.key} type="hidden" name="widget" value={row.key} />
      ))}

      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className="flex items-center gap-3 rounded-xl border border-rule bg-surface p-3"
          >
            <input
              id={`w-${row.key}`}
              type="checkbox"
              checked={row.on}
              onChange={() => toggle(index)}
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            <label htmlFor={`w-${row.key}`} className="min-w-0 flex-1 cursor-pointer text-sm">
              <span className="font-medium">{t(`widget.${row.key}`)}</span>
              <span className="mt-0.5 block text-xs text-faint">{t(`widget.${row.key}Hint`)}</span>
              {row.on && !row.allowed && (
                <span className="mt-0.5 block text-xs text-warning-ink">{t("notAllowed")}</span>
              )}
            </label>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={t("moveUp")}
                className="h-11 w-11 rounded-lg border border-rule text-lg disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === rows.length - 1}
                aria-label={t("moveDown")}
                className="h-11 w-11 rounded-lg border border-rule text-lg disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 -mx-1 flex flex-wrap gap-2 bg-background/90 px-1 py-3 backdrop-blur">
        <button type="submit" className={`${buttonPrimary} min-h-11`}>
          {t("save")}
        </button>
        <button type="submit" name="intent" value="reset" className={`${buttonSecondary} min-h-11`}>
          {t("useDefault")}
        </button>
      </div>
    </form>
  );
}
