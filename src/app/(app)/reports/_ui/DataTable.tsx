"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import { buttonSecondarySmall, inputBase } from "@/components/ui";

/**
 * The report table: sortable by any column, searchable, with a totals row.
 *
 * Every value arrives as a number and is formatted here, so sorting is by the
 * figure and never by its text ("Rp 9.000" after "Rp 10.000"). Labels arrive
 * already translated -- this component carries no words of its own.
 *
 * A long table shows its first rows and a button for the rest. Printing
 * always prints every row: the hidden ones are hidden on screen only, so the
 * paper copy an owner hands to the accountant is never quietly the top 25.
 */
export type Column = {
  key: string;
  label: string;
  kind?: "text" | "money" | "number" | "percent" | "share" | "abc";
  /** Muted figures -- costs beside prices, counts beside rupiah. */
  muted?: boolean;
  /** Colour a negative figure as the problem it is. */
  signed?: boolean;
  /** Left out of the printed page, for columns that only help on screen. */
  screenOnly?: boolean;
  /** Sort by another cell -- a month shown as "Agu 2026" sorts by "2026-08". */
  sortKey?: string;
};

export type Row = {
  id: string;
  cells: Record<string, string | number | null>;
  /** Link for the first column. */
  href?: string;
  /** Small line under the first column: a code, a note. */
  sub?: string;
  /** A marker after the first column, e.g. "from imported history". */
  tag?: string;
};

export function DataTable({
  columns,
  rows,
  totals,
  labels,
  locale,
  initialSort,
  pageSize = 25,
  searchable = false,
  minWidth = 640,
}: {
  columns: Column[];
  rows: Row[];
  totals?: Record<string, string | number | null>;
  labels: {
    empty: string;
    search?: string;
    total: string;
    showAll: string;
    showLess: string;
    sortHint: string;
    noMatch?: string;
  };
  locale: Locale;
  initialSort?: { key: string; direction: "asc" | "desc" };
  pageSize?: number;
  searchable?: boolean;
  minWidth?: number;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) =>
          [row.sub ?? "", ...Object.values(row.cells).map((value) => String(value ?? ""))]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : rows;
    if (!sort) return filtered;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = a.cells[sort.key];
      const y = b.cells[sort.key];
      if (typeof x === "number" && typeof y === "number") return (x - y) * factor;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return String(x).localeCompare(String(y), locale) * factor;
    });
  }, [rows, sort, query, locale]);

  const percent = (bps: number) =>
    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(bps / 100) + "%";

  const format = (column: Column, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value !== "number") return value;
    switch (column.kind) {
      case "money":
        return formatMoney(value);
      case "percent":
      case "share":
        return percent(value);
      case "number":
        return value.toLocaleString(locale === "id" ? "id-ID" : "en-GB");
      default:
        return String(value);
    }
  };

  const toggle = (column: Column) => {
    const key = column.sortKey ?? column.key;
    const kind = column.kind;
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: kind === "text" || kind === "abc" || !kind ? "asc" : "desc" },
    );
  };

  const limit = expanded || query ? shown.length : pageSize;
  const right = (column: Column) => column.kind && column.kind !== "text" && column.kind !== "abc";

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-rule bg-surface-2/40 px-6 py-10 text-center text-sm text-muted">
        {labels.empty}
      </div>
    );
  }

  return (
    <div>
      {searchable && (
        <div className="mb-3 print:hidden">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className={`${inputBase} w-full py-2 text-sm sm:w-80`}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-rule bg-surface shadow-[var(--shadow-card),var(--edge)] print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <table className="report-table w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-rule bg-surface-2">
              {columns.map((column) => {
                const active = sort?.key === (column.sortKey ?? column.key);
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    className={`px-3 py-2.5 align-bottom text-xs font-medium tracking-wide text-faint uppercase ${
                      right(column) ? "text-right" : "text-left"
                    } ${column.screenOnly ? "print:hidden" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(column)}
                      title={labels.sortHint}
                      className={`inline-flex items-end gap-1 uppercase hover:text-accent ${right(column) ? "text-right" : "text-left"} ${active ? "text-accent" : ""}`}
                    >
                      {column.label}
                      <span aria-hidden="true" className={`text-[0.65rem] print:hidden ${active ? "" : "opacity-0"}`}>
                        {active && sort.direction === "asc" ? "▲" : "▼"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr
                key={row.id}
                className={`border-b border-rule/60 last:border-0 ${index >= limit ? "hidden print:table-row" : ""}`}
              >
                {columns.map((column, c) => {
                  const value = row.cells[column.key];
                  const negative = column.signed && typeof value === "number" && value < 0;
                  const base = `px-3 py-2.5 ${right(column) ? "tabular text-right whitespace-nowrap" : ""} ${
                    column.muted ? "text-muted" : ""
                  } ${negative ? "text-critical" : ""} ${column.screenOnly ? "print:hidden" : ""}`;

                  if (c === 0) {
                    // Wide enough that "Amlodipine 10 mg" stays on one line;
                    // the figures give way first.
                    return (
                      <td key={column.key} className={`${base} min-w-[11rem]`}>
                        {row.href ? (
                          <Link href={row.href} className="font-medium hover:text-accent">
                            {format(column, value)}
                          </Link>
                        ) : (
                          <span className="font-medium">{format(column, value)}</span>
                        )}
                        {row.tag && (
                          <span className="ml-2 rounded-full border border-rule px-1.5 py-0.5 text-[0.65rem] text-muted">
                            {row.tag}
                          </span>
                        )}
                        {row.sub && <div className="font-mono text-xs text-faint">{row.sub}</div>}
                      </td>
                    );
                  }

                  if (column.kind === "share" && typeof value === "number") {
                    return (
                      <td key={column.key} className={`${base} w-32`}>
                        <span className="flex items-center justify-end gap-2">
                          <span aria-hidden="true" className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-surface-2 sm:block print:hidden">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${Math.max(0, Math.min(100, value / 100))}%` }}
                            />
                          </span>
                          {format(column, value)}
                        </span>
                      </td>
                    );
                  }

                  if (column.kind === "abc" && typeof value === "string") {
                    const tone =
                      value === "A"
                        ? "border-accent/40 bg-accent-soft text-accent"
                        : value === "B"
                          ? "border-rule text-foreground"
                          : "border-rule text-faint";
                    return (
                      <td key={column.key} className={base}>
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${tone}`}>
                          {value}
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td key={column.key} className={base}>
                      {format(column, value)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-muted">
                  {labels.noMatch ?? labels.empty}
                </td>
              </tr>
            )}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t-2 border-rule bg-surface-2/60 font-semibold">
                {columns.map((column, c) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2.5 ${right(column) ? "tabular text-right whitespace-nowrap" : ""} ${
                      column.screenOnly ? "print:hidden" : ""
                    } ${column.signed && typeof totals[column.key] === "number" && (totals[column.key] as number) < 0 ? "text-critical" : ""}`}
                  >
                    {c === 0 ? labels.total : totals[column.key] === undefined ? "" : format(column, totals[column.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {shown.length > pageSize && !query && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted print:hidden">
          <span className="tabular">
            {Math.min(limit, shown.length)} / {shown.length}
          </span>
          <button type="button" onClick={() => setExpanded((v) => !v)} className={buttonSecondarySmall}>
            {expanded ? labels.showLess : labels.showAll}
          </button>
        </div>
      )}
    </div>
  );
}
