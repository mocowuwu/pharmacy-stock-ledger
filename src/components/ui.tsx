import type { ReactNode } from "react";

/* Shared primitives. Deliberately small: dense operational tables and fast
   data-entry forms, not a component library. */

/**
 * Field styling without a width, for inputs that set their own. Tailwind gives
 * `w-full` and `w-20` the same specificity, so a base class carrying `w-full`
 * silently wins over a narrower one depending on stylesheet order -- which is
 * why the width is kept out of the base rather than overridden.
 */
export const inputBase =
  "rounded-lg border border-rule bg-surface px-3 py-2 text-base outline-none " +
  "focus:border-accent disabled:opacity-60";

export const inputClass = `w-full ${inputBase}`;

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted">
        {label}
        {required && <span className="ml-1 text-critical">*</span>}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-faint">{hint}</span>}
      {error && <span className="text-xs text-critical">{error}</span>}
    </label>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-rule bg-surface shadow-[0_1px_2px_rgba(23,20,31,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-rule px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>}
    </div>
  );
}

export function Alert({
  tone = "critical",
  className = "",
  children,
}: {
  tone?: "critical" | "warning" | "notice";
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    critical: "border-critical/30 bg-critical-soft text-critical",
    // Amber is used at a darker step for text than for a mark: the validated
    // identity colour is bright enough to fail contrast as small type.
    warning: "border-warning/30 bg-warning-soft text-warning-ink",
    notice: "border-notice/30 bg-notice-soft text-notice",
  } as const;
  return (
    <div
      role="alert"
      className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Indonesian drug classification, shown with the colour actually printed on the
 * box: a green circle for Obat Bebas, blue for Obat Bebas Terbatas, a red
 * circle with K for Obat Keras, a red cross for Narkotika. Staff already read
 * these marks off packaging all day, so reusing them is faster than any
 * severity palette we could invent.
 */
const CLASS_MARKS: Record<string, { color: string; glyph?: string; ring?: boolean }> = {
  bebas: { color: "#1e8f4e" },
  bebas_terbatas: { color: "#1f6fb2" },
  keras: { color: "#c1272d", glyph: "K" },
  owa: { color: "#c1272d", glyph: "K" },
  psikotropika: { color: "#c1272d", glyph: "K" },
  narkotika: { color: "#c1272d", glyph: "+" },
  jamu: { color: "#7a6a34" },
  oht: { color: "#3f7a34" },
  fitofarmaka: { color: "#2f6b3d" },
  alkes: { color: "#6b7b76" },
  consumable: { color: "#6b7b76" },
};

export function DrugClassMark({
  drugClass,
  label,
}: {
  drugClass: string;
  label: string;
}) {
  const mark = CLASS_MARKS[drugClass] ?? CLASS_MARKS.consumable;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden="true"
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 text-[8px] font-bold leading-none"
        style={{ borderColor: mark.color, color: mark.color }}
      >
        {mark.glyph ?? ""}
      </span>
      <span>{label}</span>
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  // The three severities match the alert rules, so a chip can carry the same
  // meaning wherever urgency is shown.
  tone?: "neutral" | "accent" | "critical" | "warning" | "notice";
}) {
  const tones = {
    neutral: "border-rule text-muted",
    accent: "border-accent/40 bg-accent-soft text-accent",
    critical: "border-critical/30 bg-critical-soft text-critical",
    warning: "border-warning/30 bg-warning-soft text-warning-ink",
    notice: "border-notice/30 bg-notice-soft text-notice",
  } as const;
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-xs whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A labelled figure. Used for the dashboard tiles, where the number is the
 * point and the label only has to identify it.
 */
export function Stat({
  value,
  label,
  tone = "default",
  hint,
}: {
  value: ReactNode;
  label: string;
  tone?: "default" | "critical" | "warning" | "quiet";
  hint?: string;
}) {
  const tones = {
    default: "text-foreground",
    critical: "text-critical",
    warning: "text-warning-ink",
    // A zero should not shout: nothing is wrong, so nothing draws the eye.
    quiet: "text-faint",
  } as const;
  return (
    <Card className="px-5 py-4">
      <div className={`tabular text-3xl font-semibold ${tones[tone]}`}>{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </Card>
  );
}

/** Small accent-coloured heading above a group of cards, as on the reference. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-base font-semibold tracking-tight text-accent">
      {children}
    </h2>
  );
}
