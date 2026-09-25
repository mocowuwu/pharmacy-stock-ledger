import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { moduleFlags } from "@/lib/catalogue/modules";
import { guidesFor, type Guide } from "@/lib/tutorials/guides";
import { Card, PageHeader, buttonSecondary } from "@/components/ui";
import { NavIcon } from "@/components/Sidebar";
import { StartTourButton } from "@/components/Tutorial";

/**
 * The Tutorial button's destination: every guide this account has a use for.
 * Getting started comes first and larger, because it is the one a new person
 * should read before any other; the rest follow in the order the work happens.
 */
export default async function TutorialsPage() {
  const session = await requireSession();
  const t = await getTranslations();
  const guides = guidesFor({ grant: session.grant, flags: moduleFlags(await getSettings()) });

  const [first, ...rest] = guides;

  return (
    <>
      <PageHeader
        title={t("guides.title")}
        subtitle={t("guides.subtitle")}
        actions={
          <StartTourButton
            keys={[]}
            label={t("guides.fullTour")}
            hint={t("guides.fullTourHint")}
            className={buttonSecondary}
          />
        }
      />

      {first ? (
        <section aria-labelledby="start-here">
          <h2
            id="start-here"
            className="mb-2.5 text-xs font-semibold tracking-[0.12em] text-faint uppercase"
          >
            {t("guides.startHere")}
          </h2>
          <Link href={`/tutorials/${first.key}`} className="group block">
            <Card className="flex items-center gap-4 border-accent/30 bg-accent-soft/40 px-5 py-5 transition-colors group-hover:border-accent sm:px-6">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-contrast shadow-[0_4px_14px_-4px_var(--accent)]">
                <NavIcon name={first.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold group-hover:text-accent">
                  {t(`guides.items.${first.key}.title`)}
                </span>
                <span className="mt-0.5 block text-sm text-muted">
                  {t(`guides.items.${first.key}.summary`)}
                </span>
              </span>
              <span aria-hidden="true" className="text-xl text-accent transition-transform group-hover:translate-x-1">
                →
              </span>
            </Card>
          </Link>
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section aria-labelledby="for-you" className="mt-8">
          <h2
            id="for-you"
            className="mb-2.5 text-xs font-semibold tracking-[0.12em] text-faint uppercase"
          >
            {t("guides.forYou")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((guide) => (
              <GuideCard key={guide.key} guide={guide} t={t} />
            ))}
          </div>
        </section>
      ) : null}

      <p className="mt-8 max-w-2xl text-sm text-muted">{t("guides.notListed")}</p>
    </>
  );
}

function GuideCard({
  guide,
  t,
}: {
  guide: Guide;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <Link href={`/tutorials/${guide.key}`} className="group">
      <Card className="flex h-full flex-col px-5 py-4 transition-colors group-hover:border-accent">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <NavIcon name={guide.icon} />
        </span>
        <span className="mt-3 font-medium group-hover:text-accent">
          {t(`guides.items.${guide.key}.title`)}
        </span>
        <span className="mt-1 flex-1 text-sm text-muted">
          {t(`guides.items.${guide.key}.summary`)}
        </span>
        <span className="mt-3 text-xs text-faint">
          {t("guides.sections", { count: guide.sections.length })}
        </span>
      </Card>
    </Link>
  );
}
