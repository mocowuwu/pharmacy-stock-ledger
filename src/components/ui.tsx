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
  "rounded-lg border border-rule bg-surface px-3.5 py-2.5 text-base outline-none " +
  "shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 " +
  "hover:border-faint/60 " +
  "focus:border-accent focus:shadow-[0_0_0_3px_var(--ring)] " +
  "disabled:opacity-60 disabled:shadow-none";

export const inputClass = `w-full ${inputBase}`;

/**
 * Buttons.
 *
 * These exist because the app had grown eight different spellings of "primary
 * button" -- `rounded` next to `rounded-lg`, four paddings, and, in half of
 * them, `text-white` rather than `text-accent-contrast`. That last one is not a
 * tidiness problem: in dark mode the accent is a *light* purple, so white on it
 * lands around 2.6:1 and the label on the button you press to commit a sale is
 * the hardest thing on the screen to read. `--accent-contrast` flips to near
 * black there, which is the whole reason the token exists.
 */
const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium " +
  "transition-[filter,background-color,border-color,color] duration-150 " +
  "disabled:pointer-events-none disabled:opacity-60";

export const buttonPrimary =
  `${buttonBase} bg-accent px-4 py-2.5 text-accent-contrast ` +
  "shadow-[var(--shadow-card)] hover:brightness-110 active:brightness-95";

/** The till's commit button, and anything else that is the only thing to press. */
export const buttonPrimaryLarge =
  `${buttonBase} w-full bg-accent px-5 py-3.5 text-base text-accent-contrast ` +
  "shadow-[var(--shadow-raised)] hover:brightness-110 active:brightness-95";

export const buttonSecondary =
  `${buttonBase} border border-rule bg-surface px-4 py-2.5 text-foreground ` +
  "shadow-[var(--shadow-card)] hover:border-accent/50 hover:text-accent";

/** Row-level actions inside a table, where a full-size button would set the row height. */
export const buttonSecondarySmall =
  `${buttonBase} border border-rule bg-surface px-3 py-1.5 text-xs text-muted ` +
  "hover:border-accent/50 hover:text-accent";

/** No border and no fill, for the third action in a row that already has two. */
export const buttonGhost = `${buttonBase} px-3 py-2 text-muted hover:text-accent`;

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
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground/90">
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
      className={`rounded-2xl border border-rule bg-surface shadow-[var(--shadow-card),var(--edge)] ${className}`}
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
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-rule bg-surface-2/40 px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{body}</p>}
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
      className={`rounded-xl border px-3.5 py-2.5 text-sm ${tones[tone]} ${className}`}
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
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
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
  // Not built on Card: a tinted tile has to override Card's own background and
  // border, and Tailwind gives those the same specificity -- which of the two
  // wins would then depend on stylesheet order rather than on the tone. Same
  // trap as the input widths above.
  const tones = {
    default: { figure: "text-foreground", shell: "border-rule bg-surface" },
    critical: { figure: "text-critical", shell: "border-critical/25 bg-critical-soft" },
    warning: { figure: "text-warning-ink", shell: "border-warning/25 bg-warning-soft" },
    // A zero should not shout: nothing is wrong, so nothing draws the eye.
    quiet: { figure: "text-faint", shell: "border-rule bg-surface" },
  } as const;
  const tint = tones[tone];
  return (
    // `stat` is the hook for the hover lift in globals.css, which only fires
    // when the tile is inside a link -- most are, a few are not, and a tile
    // that rises under the cursor while going nowhere is a lie about it.
    <div
      className={`stat rounded-2xl border px-5 py-5 shadow-[var(--shadow-card),var(--edge)] ${tint.shell}`}
    >
      {/* Label first, figure second. The figure still dominates -- it is three
          times the size -- but the eye gets told what it is counting before it
          reads the count. */}
      <div className="text-sm font-medium text-muted">{label}</div>
      <div
        className={`tabular mt-2 text-[2.125rem] leading-none font-semibold tracking-[-0.03em] ${tint.figure}`}
      >
        {value}
      </div>
      {hint && <div className="mt-2 text-xs text-faint">{hint}</div>}
    </div>
  );
}

/**
 * Small accent-coloured heading above a group of cards, as on the reference.
 * Set as a tracked micro-label rather than a second heading size: it is a
 * divider between groups of tiles, and at body size it competed with the page
 * title for the top of the hierarchy.
 */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3.5 text-xs font-semibold tracking-[0.08em] text-accent uppercase">
      {children}
    </h2>
  );
}
