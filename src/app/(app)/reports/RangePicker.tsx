import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PRESETS, type Preset } from "@/lib/reports/catalogue";
import { buttonSecondarySmall, inputBase } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

/**
 * The period control, shared by every report.
 *
 * A plain GET form rather than a client component: the range lives in the URL,
 * so a report is linkable, survives a reload, and the exports can be links
 * carrying the exact same parameters rather than a second source of truth about
 * what "last month" meant.
 *
 * `extra` carries anything else the view is filtered by (the product on the
 * stock card), so changing the period does not drop it.
 */
export async function RangePicker({
  basePath,
  preset,
  from,
  to,
  comparedWith,
  extra,
}: {
  basePath: string;
  preset: Preset | "custom";
  from: string;
  to: string;
  /** The comparison window, already formatted, when the report compares. */
  comparedWith?: string;
  extra?: Record<string, string | undefined>;
}) {
  const t = await getTranslations();
  const keep = Object.entries(extra ?? {}).filter((entry): entry is [string, string] => !!entry[1]);
  const href = (option: Preset) => {
    const query = new URLSearchParams([["preset", option], ...keep]);
    return `${basePath}?${query.toString()}`;
  };

  return (
    <div className="mb-6 flex flex-col gap-3 print:hidden">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <div
          role="group"
          aria-label={t("reports.range")}
          className="flex flex-wrap gap-1 rounded-xl border border-rule bg-surface p-1 shadow-[var(--shadow-card)]"
        >
          {PRESETS.map((option) => (
            <Link
              key={option}
              href={href(option)}
              aria-current={preset === option ? "true" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                preset === option
                  ? "bg-accent text-accent-contrast shadow-sm"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {t(`reports.preset.${option}`)}
            </Link>
          ))}
        </div>

        <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
          {keep.map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("reports.from")}</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              required
              className={`${inputBase} tabular w-auto py-1.5 text-sm`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("reports.to")}</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              required
              className={`${inputBase} tabular w-auto py-1.5 text-sm`}
            />
          </label>
          <button
            type="submit"
            className={`rounded-lg border px-3 py-2 text-sm ${
              preset === "custom"
                ? "border-accent bg-accent-soft text-accent"
                : "border-rule text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {t("reports.apply")}
          </button>
        </form>
      </div>
      {comparedWith && (
        <p className="text-xs text-faint">{t("reports.compare.caption", { period: comparedWith })}</p>
      )}
    </div>
  );
}

/**
 * Print and the two downloads.
 *
 * Links, not buttons: they carry the same query the page is showing, so what
 * downloads is exactly what is on screen. The route handler re-checks the
 * permission -- it is as exposed as any page and gets no special trust.
 */
export async function ReportActions({
  basePath,
  from,
  to,
  preset,
  extra,
}: {
  basePath: string;
  from: string;
  to: string;
  preset: Preset | "custom";
  /** Anything else the screen is filtered by, so the file matches the view. */
  extra?: Record<string, string | undefined>;
}) {
  const t = await getTranslations();
  const query = new URLSearchParams({ from, to });
  if (preset !== "custom") query.set("preset", preset);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) query.set(key, value);
  }
  const xlsx = new URLSearchParams(query);
  xlsx.set("format", "xlsx");

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <PrintButton label={t("reports.print")} />
      <a
        href={`${basePath}/export?${xlsx.toString()}`}
        className={buttonSecondarySmall}
        title={t("reports.exportXlsxHint")}
      >
        {t("reports.exportXlsx")}
      </a>
      <a
        href={`${basePath}/export?${query.toString()}`}
        className={buttonSecondarySmall}
        title={t("reports.exportHint")}
      >
        {t("reports.export")}
      </a>
    </div>
  );
}

/**
 * The top of a printed report: whose report it is, what it covers, and who
 * printed it when. Hidden on screen, where the page header already says so.
 */
export function PrintLetterhead({
  business,
  address,
  title,
  period,
  printedBy,
}: {
  business: string;
  address?: string | null;
  title: string;
  period: string;
  printedBy: string;
}) {
  return (
    <div className="mb-6 hidden border-b-2 border-foreground pb-3 print:block">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-lg font-bold">{business}</p>
          {address && <p className="text-xs">{address}</p>}
        </div>
        <div className="text-right">
          <p className="text-base font-semibold">{title}</p>
          <p className="text-xs">{period}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted">{printedBy}</p>
    </div>
  );
}
