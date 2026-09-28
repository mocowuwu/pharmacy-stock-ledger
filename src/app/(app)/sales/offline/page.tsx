import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listOfflineReviews } from "@/lib/dal/offline";
import {
  Alert,
  Card,
  Chip,
  EmptyState,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
  buttonSecondarySmall,
  inputClass,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { resolveOfflineReviewAction } from "./actions";

/**
 * Offline sales a manager has to look at.
 *
 * Two kinds, and they need different decisions. A sale that could not be
 * booked is medicine that left the shop with no ledger entry yet: book it once
 * the stock is right, or close it saying how the stock was corrected. A flagged
 * sale is already booked; it only needs someone to agree it was fine.
 */
export default async function OfflineReviewPage({ searchParams }: PageProps<"/sales/offline">) {
  const session = await requirePermission("sales.view_all");
  const t = await getTranslations();
  const query = await searchParams;
  const showClosed = query.show === "closed";
  const reviews = await listOfflineReviews({ open: !showClosed });
  const locale = session.user.locale;

  return (
    <>
      <PageHeader
        title={t("offlineReview.title")}
        subtitle={t("offlineReview.subtitle")}
        actions={
          <Link
            href={showClosed ? "/sales/offline" : "/sales/offline?show=closed"}
            className={buttonSecondary}
          >
            {showClosed ? t("offlineReview.showOpen") : t("offlineReview.showClosed")}
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {typeof query.posted === "string" && (
          <Alert tone="notice">{t("offlineReview.posted", { number: query.posted })}</Alert>
        )}
        {query.closed && <Alert tone="notice">{t("offlineReview.closed")}</Alert>}
        {typeof query.error === "string" && <Alert>{t(`errors.${query.error}`)}</Alert>}
      </div>

      {reviews.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title={showClosed ? t("offlineReview.emptyClosed") : t("offlineReview.empty")}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map((review) => (
            <Card key={review.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{review.offlineNumber}</span>
                    <Chip tone={review.kind === "not_posted" ? "critical" : "warning"}>
                      {t(`offlineReview.kind.${review.kind}`)}
                    </Chip>
                    {review.saleId && review.saleNumber && (
                      <Link
                        href={`/sales/${review.saleId}`}
                        className="font-mono text-xs text-muted hover:text-accent"
                      >
                        → {review.saleNumber}
                      </Link>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {t("offlineReview.soldBy", {
                      cashier: review.cashier,
                      device: review.device,
                      when: formatDateTime(review.soldAt, locale),
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <div className="tabular font-semibold">{formatMoney(review.total)}</div>
                  <div className="text-xs text-faint">
                    {t("offlineReview.lines", { count: review.lineCount })}
                  </div>
                </div>
              </div>

              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {review.reasons.map((reason) => (
                  <li key={reason} className="text-muted">
                    • {t.has(`offlineReview.reason.${reason}`)
                      ? t(`offlineReview.reason.${reason}`)
                      : t.has(`errors.${reason}`)
                        ? t(`errors.${reason}`)
                        : reason}
                  </li>
                ))}
              </ul>

              {review.resolvedAt ? (
                <p className="mt-3 border-t border-rule pt-3 text-sm text-muted">
                  {t("offlineReview.resolvedBy", {
                    name: review.resolvedBy ?? "",
                    when: formatDateTime(review.resolvedAt, locale),
                  })}
                  : {review.resolutionNote}
                </p>
              ) : (
                <form
                  action={resolveOfflineReviewAction}
                  className="mt-4 flex flex-col gap-3 border-t border-rule pt-4"
                >
                  <input type="hidden" name="reviewId" value={review.id} />
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t("offlineReview.note")}</span>
                    <input
                      name="note"
                      required
                      maxLength={500}
                      className={inputClass}
                      placeholder={t("offlineReview.notePlaceholder")}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {review.kind === "not_posted" && (
                      <button type="submit" name="intent" value="post" className={buttonPrimary}>
                        {t("offlineReview.post")}
                      </button>
                    )}
                    <button
                      type="submit"
                      name="intent"
                      value="close"
                      className={review.kind === "not_posted" ? buttonSecondarySmall : buttonPrimary}
                    >
                      {review.kind === "not_posted"
                        ? t("offlineReview.closeWithoutPosting")
                        : t("offlineReview.accept")}
                    </button>
                  </div>
                  {review.kind === "not_posted" && (
                    <p className="text-xs text-faint">{t("offlineReview.notPostedHint")}</p>
                  )}
                </form>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
