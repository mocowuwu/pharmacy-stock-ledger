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

/** A compact field for inline table/row editing, where the full input padding overruns the row. */
export const inputSmall = `${inputBase} py-1 text-xs`;

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
// Radius is left out of buttonBase and set per-variant instead: Tailwind
// gives same-property utilities equal specificity, so stacking `rounded-lg`
// from a base class against a `rounded-full` override is a coin flip on
// stylesheet order, the same trap the width comment above describes.
const buttonBase =
  "inline-flex items-center justify-center gap-2 text-sm font-medium " +
  "transition-[filter,background-color,border-color,color] duration-150 " +
  "disabled:pointer-events-none disabled:opacity-60";

// Pill-shaped, per the reference's own rule: pills are for status chips and
// primary Till buttons only, not every button -- secondary/ghost buttons
// below stay rounded-lg.
export const buttonPrimary =
  `${buttonBase} rounded-full bg-accent px-4 py-2.5 text-accent-contrast ` +
  "shadow-[var(--shadow-card)] hover:brightness-110 active:brightness-95";

/** The till's commit button, and anything else that is the only thing to press. */
export const buttonPrimaryLarge =
  `${buttonBase} w-full rounded-full bg-accent px-5 py-3.5 text-base text-accent-contrast ` +
  "shadow-[var(--shadow-raised)] hover:brightness-110 active:brightness-95";

export const buttonSecondary =
  `${buttonBase} rounded-lg border border-rule bg-surface px-4 py-2.5 text-foreground ` +
  "shadow-[var(--shadow-card)] hover:border-accent/50 hover:text-accent";

/**
 * The reference's other secondary style -- light purple tint, pill-shaped --
 * for an action that should read as more than a neutral secondary but isn't
 * the one thing on the screen to press (a segmented toggle's selected state,
 * a quick-select preset). `buttonSecondary` stays neutral for routine row
 * actions; this is for the times color is doing real communicative work.
 */
export const buttonAccentSoft =
  `${buttonBase} rounded-full bg-accent-soft px-4 py-2.5 text-accent ` +
  "hover:brightness-95 active:brightness-90";

/** Row-level actions inside a table, where a full-size button would set the row height. */
export const buttonSecondarySmall =
  `${buttonBase} rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs text-muted ` +
  "hover:border-accent/50 hover:text-accent";

/** No border and no fill, for the third action in a row that already has two. */
export const buttonGhost = `${buttonBase} rounded-lg px-3 py-2 text-muted hover:text-accent`;

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
  glass = false,
}: {
  children: ReactNode;
  className?: string;
  // Surface 2 per the reference: a genuinely floating card (a sticky summary
  // panel) rather than the normal opaque Surface 1. Kept as a prop rather
  // than letting a caller stack `.glass` onto this component's own className
  // -- .glass and `bg-surface` both set `background`, and which one wins
  // would depend on Tailwind's generated stylesheet order, not source order.
  glass?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-rule shadow-[var(--shadow-card),var(--edge)] ${glass ? "glass" : "bg-surface"} ${className}`}
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
  tone?: "default" | "accent" | "critical" | "warning" | "quiet";
  hint?: string;
}) {
  // Not built on Card: a tinted tile has to override Card's own background and
  // border, and Tailwind gives those the same specificity -- which of the two
  // wins would then depend on stylesheet order rather than on the tone. Same
  // trap as the input widths above.
  const tones = {
    default: { figure: "text-foreground", shell: "border-rule bg-surface" },
    // For a headline figure that is good news rather than a status -- today's
    // takings, not a count of what's wrong -- so it reads as the brand's own
    // colour rather than the critical/warning severity scale.
    accent: { figure: "text-accent", shell: "border-accent/20 bg-accent-soft" },
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

/**
 * A data-table header row. Pulled out because the same string was hand-typed
 * verbatim in more than one screen -- every table header in the app should
 * look and behave identically, and a copy that drifts is how they stop.
 */
export function Th({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`border-b border-rule bg-surface-2 px-3 py-2 text-left text-xs font-medium tracking-wide whitespace-nowrap text-faint uppercase ${className}`}
    >
      {children}
    </th>
  );
}

/**
 * A label/value row for totals and payment breakdowns. `strong` marks the
 * line that carries the actual total, which is heavier and sits apart from
 * the lines above it rather than just being another row.
 */
export function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${
        strong ? "text-base font-semibold" : "text-sm text-muted"
      }`}
    >
      {/* The total is the one figure on this row group that isn't merely
          informational -- it's what the cashier is about to collect, so it
          carries the brand's own colour rather than reading as plain text. */}
      <span className={strong ? "text-foreground" : ""}>{label}</span>
      <span className={`tabular ${strong ? "text-lg text-accent" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
