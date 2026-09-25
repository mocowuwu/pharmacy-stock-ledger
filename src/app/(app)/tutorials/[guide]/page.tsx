import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { moduleFlags } from "@/lib/catalogue/modules";
import { guidesFor, type GuideSection } from "@/lib/tutorials/guides";
import { Card, buttonPrimary } from "@/components/ui";
import { NavIcon } from "@/components/Sidebar";
import { StartTourButton } from "@/components/Tutorial";

/**
 * One guide, as numbered steps. A guide this account is not offered is a 404
 * rather than a lecture on a screen it cannot open -- the same answer the menu
 * gives by not listing it.
 */
export default async function GuidePage({ params }: PageProps<"/tutorials/[guide]">) {
  const session = await requireSession();
  const t = await getTranslations();
  const { guide: key } = await params;

  const guides = guidesFor({ grant: session.grant, flags: moduleFlags(await getSettings()) });
  const index = guides.findIndex((g) => g.key === key);
  if (index === -1) notFound();
  const guide = guides[index];
  const next = guides[index + 1];
  const base = `guides.items.${guide.key}`;

  return (
    <>
      <Link
        href="/tutorials"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent"
      >
        <span aria-hidden="true">←</span>
        {t("guides.back")}
      </Link>

      <header className="mb-8 flex flex-wrap items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-contrast shadow-[0_4px_14px_-4px_var(--accent)]">
          <NavIcon name={guide.icon} />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
            {t(`${base}.title`)}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">{t(`${base}.summary`)}</p>
        </div>
        <div className="flex flex-col items-start gap-1">
          <StartTourButton
            keys={guide.tour}
            label={t("guides.showMe")}
            className={buttonPrimary}
          />
          <span className="max-w-60 text-xs text-faint">{t("guides.showMeHint")}</span>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        {guide.sections.length > 2 ? (
          <nav aria-label={t("guides.contents")} className="lg:sticky lg:top-8 lg:self-start">
            <p className="mb-2 text-xs font-semibold tracking-[0.12em] text-faint uppercase">
              {t("guides.contents")}
            </p>
            <ol className="flex flex-col gap-0.5 border-l border-rule">
              {guide.sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="-ml-px block border-l-2 border-transparent py-1 pl-3 text-sm text-muted hover:border-accent hover:text-accent"
                  >
                    {t(`${base}.sections.${section.id}.title`)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : (
          <div className="hidden lg:block" />
        )}

        <div className="flex min-w-0 flex-col gap-4">
          {guide.sections.map((section) => (
            <GuideSectionCard
              key={section.id}
              section={section}
              base={`${base}.sections.${section.id}`}
              t={t}
            />
          ))}

          {next ? (
            <Link href={`/tutorials/${next.key}`} className="group mt-4">
              <Card className="flex items-center gap-4 px-5 py-4 transition-colors group-hover:border-accent">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-faint">{t("guides.next")}</span>
                  <span className="block font-medium group-hover:text-accent">
                    {t(`guides.items.${next.key}.title`)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-lg text-accent">
                  →
                </span>
              </Card>
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}

function GuideSectionCard({
  section,
  base,
  t,
}: {
  section: GuideSection;
  base: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  // Numbered keys rather than an array: the catalogues are trees of strings,
  // which is what the parity test walks. Integer keys iterate in order.
  const steps = Object.values(t.raw(`${base}.steps`) as Record<string, string>);

  return (
    <Card className="px-5 py-5 sm:px-6">
      <section id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-24">
        <h2 id={`${section.id}-title`} className="text-lg font-semibold">
          {t(`${base}.title`)}
        </h2>
        <ol className="mt-3 flex flex-col gap-2.5">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent tabular-nums"
              >
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
        {section.tip ? (
          <Callout tone="notice" label={t("guides.tip")}>
            {t(`${base}.tip`)}
          </Callout>
        ) : null}
        {section.warn ? (
          <Callout tone="warning" label={t("guides.careful")}>
            {t(`${base}.warn`)}
          </Callout>
        ) : null}
      </section>
    </Card>
  );
}

/** The alert colours, without `role="alert"`: this is advice on a page, not news. */
function Callout({
  tone,
  label,
  children,
}: {
  tone: "notice" | "warning";
  label: string;
  children: React.ReactNode;
}) {
  const tones = {
    notice: "border-notice/30 bg-notice-soft text-notice",
    warning: "border-warning/30 bg-warning-soft text-warning-ink",
  } as const;
  return (
    <p className={`mt-4 rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed ${tones[tone]}`}>
      <strong className="font-semibold">{label}: </strong>
      {children}
    </p>
  );
}
