import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PRESETS, type Preset } from "@/lib/reports/catalogue";
import { inputBase } from "@/components/ui";

/**
 * The period control, shared by every report.
 *
 * A plain GET form rather than a client component: the range lives in the URL,
 * so a report is linkable, survives a reload, and the CSV export can be a link
 * carrying the exact same parameters rather than a second source of truth about
 * what "last month" meant.
 */
export async function RangePicker({
  basePath,
  preset,
  from,
  to,
}: {
  basePath: string;
  preset: Preset | "custom";
  from: string;
  to: string;
}) {
  const t = await getTranslations();

  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-2 gap-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((option) => (
          <Link
            key={option}
            href={`${basePath}?preset=${option}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              preset === option
                ? "border-accent bg-accent-soft text-accent"
                : "border-rule text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {t(`reports.preset.${option}`)}
          </Link>
        ))}
      </div>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("reports.from")}</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className={`${inputBase} tabular w-auto py-1.5 text-sm`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t("reports.to")}</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className={`${inputBase} tabular w-auto py-1.5 text-sm`}
          />
        </label>
        <button
          type="submit"
          className={`rounded-lg border px-3 py-1.5 text-sm ${
            preset === "custom"
              ? "border-accent bg-accent-soft text-accent"
              : "border-rule text-muted hover:border-accent hover:text-accent"
          }`}
        >
          {t("reports.apply")}
        </button>
      </form>
    </div>
  );
}

/**
 * The download link.
 *
 * A link, not a button: it carries the same query the page is showing, so what
 * downloads is exactly what is on screen. The route handler re-checks the
 * permission -- it is as exposed as any page and gets no special trust.
 */
export async function ExportLink({
  basePath,
  from,
  to,
}: {
  basePath: string;
  from: string;
  to: string;
}) {
  const t = await getTranslations();
  return (
    <a
      href={`${basePath}/export?from=${from}&to=${to}`}
      className="rounded-lg border border-rule px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent"
      title={t("reports.exportHint")}
    >
      {t("reports.export")}
    </a>
  );
}
