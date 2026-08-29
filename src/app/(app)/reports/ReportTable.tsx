import type { ReactNode } from "react";
import { Card, EmptyState, SectionHeading } from "@/components/ui";

/**
 * A titled table that scrolls sideways rather than wrapping its headers.
 *
 * Every report is the same shape -- a heading, some columns, a lot of rows --
 * so it is written once. `minWidth` is per-table because a two-column summary
 * and a seven-column item list want different floors.
 */
export function ReportTable({
  title,
  columns,
  minWidth = 720,
  empty,
  children,
  note,
}: {
  title: string;
  /** `align: "right"` for anything numeric, which is most of it. */
  columns: Array<{ label: string; align?: "left" | "right" }>;
  minWidth?: number;
  empty?: string;
  children: ReactNode;
  note?: string;
}) {
  const rows = Array.isArray(children) ? children.flat() : [children];
  const isEmpty = rows.filter(Boolean).length === 0;

  return (
    <section className="mb-8">
      <SectionHeading>{title}</SectionHeading>
      {note && <p className="mb-3 -mt-1 text-sm text-muted">{note}</p>}

      {isEmpty ? (
        <Card className="p-6">
          <EmptyState title={empty ?? ""} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth }}>
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.label}
                    className={`px-4 py-2.5 font-medium whitespace-nowrap ${
                      column.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-rule/60 last:border-0">{children}</tr>;
}

/** A cell. Numbers get tabular figures so columns of rupiah line up. */
export function Cell({
  children,
  align = "left",
  muted = false,
  tone,
}: {
  children: ReactNode;
  align?: "left" | "right";
  muted?: boolean;
  tone?: "critical" | "warning" | "default";
}) {
  const tones = {
    critical: "text-critical",
    warning: "text-warning-ink",
    default: "",
  } as const;

  return (
    <td
      className={`px-4 py-2.5 ${align === "right" ? "tabular text-right whitespace-nowrap" : ""} ${
        muted ? "text-muted" : ""
      } ${tone ? tones[tone] : ""}`}
    >
      {children}
    </td>
  );
}

/** Renders basis points as a percentage: 6000 -> "60,0%". */
export function percentFromBps(bps: number, locale: "id" | "en"): string {
  return new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-GB", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(bps / 100) + "%";
}
