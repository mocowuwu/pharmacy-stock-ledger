import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import {
  effectiveTaxRate,
  getSettings,
  listTaxRates,
} from "@/lib/dal/settings";
import {
  Alert,
  Card,
  Field,
  PageHeader,
  SectionHeading,
  inputBase,
  inputClass,
} from "@/components/ui";
import { formatDate } from "@/lib/format/date";
import { MODULES, moduleFlags, type ModuleKey } from "@/lib/catalogue/modules";
import { createTaxRate, saveSettings } from "./actions";

/** The three the pharmacy is plausibly in. Not a picker of every zone on earth. */
const TIMEZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
      </span>
    </label>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const session = await requirePermission("settings.manage");
  const t = await getTranslations();
  const query = await searchParams;
  const locale = session.user.locale;

  const settings = await getSettings();
  const rates = await listTaxRates();
  const current = await effectiveTaxRate();
  const flags = moduleFlags(settings);

  const MODULE_FIELD: Record<ModuleKey, string> = {
    returns: "returnsEnabled",
    barcodes: "barcodesEnabled",
    tax: "taxEnabled",
    narkotika: "narkotikaEnabled",
  };

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <div className="mb-6 flex flex-col gap-3">
        {query.saved && <Alert tone="notice">{t("settings.saved")}</Alert>}
        {query.rateAdded && <Alert tone="notice">{t("settings.taxRateAdded")}</Alert>}
        {typeof query.error === "string" && (
          <Alert>{t(`errors.${query.error}`)}</Alert>
        )}
        {/* Tax switched on with no rate covering today books every sale with no
            PPN at all, and nothing looks wrong until an accountant asks. */}
        {settings.taxEnabled && !current && (
          <Alert tone="warning">{t("settings.noEffectiveRate")}</Alert>
        )}
      </div>

      <form action={saveSettings} className="flex flex-col gap-8">
        <section>
          <SectionHeading>{t("settings.business")}</SectionHeading>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Field
              label={t("settings.businessName")}
              hint={t("settings.businessNameHint")}
              required
            >
              <input
                name="businessName"
                required
                defaultValue={settings.businessName}
                className={inputClass}
              />
            </Field>
            <Field label={t("settings.businessPhone")}>
              <input
                name="businessPhone"
                defaultValue={settings.businessPhone ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label={t("settings.businessAddress")}>
              <input
                name="businessAddress"
                defaultValue={settings.businessAddress ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label={t("settings.licence")} hint={t("settings.licenceHint")}>
              <input
                name="licenceNumber"
                defaultValue={settings.licenceNumber ?? ""}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label={t("settings.npwp")} hint={t("settings.npwpHint")}>
              <input
                name="npwp"
                defaultValue={settings.npwp ?? ""}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label={t("settings.timezone")} hint={t("settings.timezoneHint")}>
              <select
                name="timezone"
                defaultValue={settings.timezone}
                className={inputClass}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </Field>
          </Card>
        </section>

        <section>
          <SectionHeading>{t("settings.receipt")}</SectionHeading>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Field
              label={t("settings.receiptLocale")}
              hint={t("settings.receiptLocaleHint")}
            >
              <select
                name="receiptLocale"
                defaultValue={settings.receiptLocale}
                className={inputClass}
              >
                <option value="id">Bahasa Indonesia</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label={t("settings.receiptFooter")}>
              <input
                name="receiptFooter"
                defaultValue={settings.receiptFooter ?? ""}
                className={inputClass}
              />
            </Field>
          </Card>
        </section>

        <section>
          <SectionHeading>{t("settings.modules")}</SectionHeading>
          <p className="mb-3 -mt-1 text-sm text-muted">{t("settings.modulesHint")}</p>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            {MODULES.map((key) => (
              <Toggle
                key={key}
                name={MODULE_FIELD[key]}
                label={t(`settings.module.${key}`)}
                hint={t(`settings.module.${key}Hint`)}
                defaultChecked={flags[key]}
              />
            ))}
          </Card>
        </section>

        <section>
          <SectionHeading>{t("settings.tax")}</SectionHeading>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t("settings.taxMode")}>
              <select
                name="taxMode"
                defaultValue={settings.taxMode}
                className={inputClass}
              >
                <option value="exclusive">{t("settings.taxExclusive")}</option>
                <option value="inclusive">{t("settings.taxInclusive")}</option>
              </select>
            </Field>
          </Card>
        </section>

        <section>
          <SectionHeading>{t("settings.alerts")}</SectionHeading>
          <p className="mb-3 -mt-1 text-sm text-muted">{t("settings.alertsHint")}</p>
          <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("settings.expiringUrgent")}>
              <input
                name="expiringUrgentDays"
                inputMode="numeric"
                defaultValue={settings.expiringUrgentDays}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label={t("settings.expiringNotice")}>
              <input
                name="expiringNoticeDays"
                inputMode="numeric"
                defaultValue={settings.expiringNoticeDays}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label={t("settings.deadStockNoSale")}>
              <input
                name="deadStockNoSaleDays"
                inputMode="numeric"
                defaultValue={settings.deadStockNoSaleDays}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label={t("settings.deadStockExpiry")}>
              <input
                name="deadStockExpiryDays"
                inputMode="numeric"
                defaultValue={settings.deadStockExpiryDays}
                className={`${inputClass} tabular`}
              />
            </Field>
          </Card>
        </section>

        <section>
          <SectionHeading>{t("settings.returns")}</SectionHeading>
          <Card className="p-5">
            <Toggle
              name="allowReturnRestock"
              label={t("settings.allowRestock")}
              hint={t("settings.allowRestockHint")}
              defaultChecked={settings.allowReturnRestock}
            />
          </Card>
        </section>

        <section>
          <SectionHeading>{t("settings.digest")}</SectionHeading>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Toggle
              name="digestEnabled"
              label={t("settings.digestEnabled")}
              hint={t("settings.digestNotBuilt")}
              defaultChecked={settings.digestEnabled}
            />
            <Field label={t("settings.digestEmail")}>
              <input
                name="digestEmail"
                type="email"
                defaultValue={settings.digestEmail ?? ""}
                className={inputClass}
              />
            </Field>
          </Card>
        </section>

        <div>
          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            {t("settings.save")}
          </button>
        </div>
      </form>

      {/* Its own form: adding a rate is a separate, dated decision, and it must
          not ride along with an unrelated settings save. */}
      <section className="mt-10">
        <SectionHeading>{t("settings.taxRates")}</SectionHeading>
        <p className="mb-3 -mt-1 text-sm text-muted">
          {t("settings.taxRateHistoryHint")}
        </p>

        <Card className="mb-4 overflow-x-auto">
          {rates.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">{t("settings.noTaxRates")}</p>
          ) : (
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-rule text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">
                    {t("settings.taxRateName")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {t("settings.taxRatePercent")}
                  </th>
                  <th className="px-4 py-2.5 font-medium">
                    {t("settings.taxRateFrom")}
                  </th>
                  <th className="px-4 py-2.5 font-medium">{t("settings.taxRateTo")}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id} className="border-b border-rule/60 last:border-0">
                    <td className="px-4 py-2.5">
                      {rate.name}
                      {current?.id === rate.id && (
                        <span className="ml-2 text-xs text-accent">
                          {t("settings.taxRateCurrent")}
                        </span>
                      )}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {(rate.rateBps / 100).toFixed(2)}%
                    </td>
                    <td className="tabular px-4 py-2.5">
                      {formatDate(rate.effectiveFrom, locale)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-muted">
                      {rate.effectiveTo ? formatDate(rate.effectiveTo, locale) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5">
          <form action={createTaxRate} className="flex flex-wrap items-end gap-3">
            <Field label={t("settings.taxRateName")}>
              <input name="name" required defaultValue="PPN" className={inputBase} />
            </Field>
            <Field label={t("settings.taxRatePercent")}>
              <input
                name="percent"
                inputMode="decimal"
                required
                className={`${inputBase} tabular w-28`}
              />
            </Field>
            <Field label={t("settings.taxRateFrom")}>
              <input
                type="date"
                name="effectiveFrom"
                required
                className={`${inputBase} tabular`}
              />
            </Field>
            <button
              type="submit"
              className="rounded-lg border border-rule px-4 py-2 text-sm text-muted hover:border-accent hover:text-accent"
            >
              {t("settings.addTaxRate")}
            </button>
          </form>
        </Card>
      </section>
    </>
  );
}
