import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { batchForDisposal, witnessOptions } from "@/lib/dal/disposal";
import {
  Alert,
  Card,
  DrugClassMark,
  Field,
  PageHeader,
  inputClass,
} from "@/components/ui";
import { formatExpiry } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { RESTRICTED_DRUG_CLASSES } from "@/lib/catalogue/enums";
import { submitDisposal } from "./actions";

export default async function DisposeBatchPage({
  params,
  searchParams,
}: PageProps<"/dispose/[batchId]">) {
  const session = await requirePermission("stock.dispose");
  const t = await getTranslations();
  const { batchId } = await params;
  const query = await searchParams;

  const batch = await batchForDisposal(batchId);
  if (!batch) notFound();

  const witnesses = await witnessOptions();
  const locale = session.user.locale;
  const label = `${batch.genericName}${batch.strength ? ` ${batch.strength}` : ""}`;
  const restricted = (RESTRICTED_DRUG_CLASSES as readonly string[]).includes(
    batch.drugClass,
  );

  return (
    <>
      <PageHeader title={t("dispose.title")} subtitle={label} />

      {typeof query.error === "string" && (
        <Alert className="mb-4">{t(`errors.${query.error}`)}</Alert>
      )}

      <Card className="mb-4 p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">{t("sell.item")}</dt>
            <dd className="mt-0.5">
              <DrugClassMark drugClass={batch.drugClass} label={label} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("dispose.batch")}</dt>
            <dd className="mt-0.5 font-mono text-xs">
              {batch.lotNumber ?? "—"}
              <div className="text-faint">
                {formatExpiry(batch.expiryDate, locale)}
              </div>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("dispose.onHand")}</dt>
            <dd className="tabular mt-0.5">
              {batch.qtyRemaining} {batch.unit}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("dispose.costValue")}</dt>
            <dd className="tabular mt-0.5">
              {formatMoney(batch.qtyRemaining * batch.unitCost)}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Said before the form, not after it. A disposal is one of the two
          irreversible things in this system -- the other is a sale -- and the
          lot number is the thing most worth checking twice. */}
      <Alert tone="warning" className="mb-4">
        <strong className="block">{t("dispose.confirmTitle")}</strong>
        {t("dispose.confirmBody")}
      </Alert>

      <Card className="p-5">
        <form action={submitDisposal} className="flex flex-col gap-4">
          <input type="hidden" name="batchId" value={batch.id} />
          <input type="hidden" name="itemLabel" value={label} />
          <input type="hidden" name="unitLabel" value={batch.unit} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("dispose.qty")}
              hint={t("dispose.qtyAll", { count: batch.qtyRemaining })}
              required
            >
              <input
                name="qty"
                inputMode="numeric"
                required
                defaultValue={batch.qtyRemaining}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label={t("dispose.reason")} required>
              <input
                name="reason"
                required
                placeholder={t("dispose.reasonPlaceholder")}
                className={inputClass}
              />
            </Field>
            <Field label={t("dispose.method")}>
              <input
                name="method"
                placeholder={t("dispose.methodPlaceholder")}
                className={inputClass}
              />
            </Field>
            <Field
              label={t("dispose.witness")}
              hint={restricted ? t("errors.pharmacist_required") : undefined}
            >
              <select name="witnessedBy" defaultValue="" className={inputClass}>
                <option value="">{t("dispose.noWitness")}</option>
                {witnesses
                  .filter((user) => user.id !== session.user.id)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <Field label={t("dispose.notes")}>
            <input name="notes" className={inputClass} />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-critical px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              {t("dispose.submit")}
            </button>
            <Link href="/dispose" className="text-sm text-muted hover:text-accent">
              {t("common.cancel")}
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
