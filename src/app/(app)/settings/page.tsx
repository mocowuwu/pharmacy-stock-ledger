import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import {
  effectiveTaxRate,
  getSettings,
  listTaxRates,
} from "@/lib/dal/settings";
import { Alert, Card, Field, PageHeader, SectionHeading, buttonPrimary, buttonSecondary, inputBase, inputClass } from "@/components/ui";
import { formatDate } from "@/lib/format/date";
import { MODULES, moduleFlags, type ModuleKey } from "@/lib/catalogue/modules";
import {
  INDONESIAN_TIMEZONES,
  otherTimezones,
  systemTimezone,
  timezoneLabel,
} from "@/lib/format/timezones";
import { mailSettings } from "@/lib/dal/settings";
import { demoDataSummary, RESET_CONFIRMATION } from "@/lib/dal/maintenance";
import { digestReadiness } from "@/lib/digest/job";
import { createTaxRate, saveSettings, testMailSettings, wipeDemoData } from "./actions";


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
  const mail = await mailSettings();
  const demo = await demoDataSummary();
  const readiness = digestReadiness(settings);
  const machineZone = systemTimezone();

  const MODULE_FIELD: Record<ModuleKey, string> = {
    returns: "returnsEnabled",
    barcodes: "barcodesEnabled",
    tax: "taxEnabled",
    narkotika: "narkotikaEnabled",
    suppliers: "suppliersEnabled",
    categories: "categoriesEnabled",
    counts: "countsEnabled",
    dispose: "disposeEnabled",
    import: "importEnabled",
  };

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <div className="mb-6 flex flex-col gap-3">
        {query.saved && <Alert tone="notice">{t("settings.saved")}</Alert>}
        {query.rateAdded && <Alert tone="notice">{t("settings.taxRateAdded")}</Alert>}
        {query.wiped && <Alert tone="notice">{t("settings.demoWiped")}</Alert>}
        {query.mail === "ok" && <Alert tone="notice">{t("settings.mailOk")}</Alert>}
        {query.mail === "failed" && (
          <Alert>
            {t("settings.mailFailed")}
            {typeof query.detail === "string" && (
              <span className="mt-1 block font-mono text-xs">{query.detail}</span>
            )}
          </Alert>
        )}
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
            <Field
              label={t("settings.businessTagline")}
              hint={t("settings.businessTaglineHint")}
            >
              <input
                name="businessTagline"
                defaultValue={settings.businessTagline ?? ""}
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
            <Field
              label={t("settings.timezone")}
              hint={
                machineZone !== settings.timezone
                  ? t("settings.timezoneMismatch", { zone: machineZone })
                  : t("settings.timezoneHint")
              }
            >
              <select
                name="timezone"
                defaultValue={settings.timezone}
                className={inputClass}
              >
                {/* The Indonesian zones first, under the names staff use. */}
                <optgroup label="Indonesia">
                  {INDONESIAN_TIMEZONES.map((zone) => (
                    <option key={zone.zone} value={zone.zone}>
                      {timezoneLabel(zone.zone)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("settings.timezoneOther")}>
                  {otherTimezones().map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </optgroup>
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
          <p className="mb-3 -mt-1 text-sm text-muted">{t("settings.digestHint")}</p>

          {readiness === "preview_only" && (
            <Alert tone="notice" className="mb-3">
              {t("settings.digestPreviewOnly")}
            </Alert>
          )}

          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Toggle
              name="digestEnabled"
              label={t("settings.digestEnabled")}
              hint={t("settings.digestEnabledHint")}
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
            <Field label={t("settings.digestHour")} hint={t("settings.digestHourHint")}>
              <select
                name="digestHour"
                defaultValue={settings.digestHour}
                className={inputClass}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </Field>
          </Card>
        </section>

        <section>
          <SectionHeading>{t("settings.mail")}</SectionHeading>
          <p className="mb-3 -mt-1 text-sm text-muted">{t("settings.mailHint")}</p>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t("settings.smtpHost")} hint={t("settings.smtpHostHint")}>
              <input
                name="smtpHost"
                defaultValue={mail.host ?? ""}
                placeholder="smtp.gmail.com"
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label={t("settings.smtpPort")}>
              <input
                name="smtpPort"
                inputMode="numeric"
                defaultValue={mail.port}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label={t("settings.smtpUser")}>
              <input
                name="smtpUser"
                autoComplete="off"
                defaultValue={mail.user ?? ""}
                className={`${inputClass} font-mono`}
              />
            </Field>
            {/* Never rendered back. Blank means "keep the stored one". */}
            <Field
              label={t("settings.smtpPassword")}
              hint={
                mail.hasPassword
                  ? t("settings.smtpPasswordStored")
                  : t("settings.smtpPasswordHint")
              }
            >
              <input
                name="smtpPassword"
                type="password"
                autoComplete="new-password"
                placeholder={mail.hasPassword ? "••••••••" : ""}
                className={inputClass}
              />
            </Field>
            <Field label={t("settings.smtpFrom")} hint={t("settings.smtpFromHint")}>
              <input
                name="smtpFrom"
                defaultValue={mail.from ?? ""}
                placeholder="Apotek Klinik <apotek@example.com>"
                className={inputClass}
              />
            </Field>
            <Toggle
              name="smtpSecure"
              label={t("settings.smtpSecure")}
              hint={t("settings.smtpSecureHint")}
              defaultChecked={mail.secure}
            />
          </Card>
        </section>

        <div>
          <button
            type="submit"
            className={buttonPrimary}
          >
            {t("settings.save")}
          </button>
        </div>
      </form>

      {/* Its own form: testing uses what is saved, so it must not be able to
          ride along with unsaved edits and report on something else. */}
      <section className="mt-10">
        <SectionHeading>{t("settings.mailTest")}</SectionHeading>
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted">{t("settings.mailTestHint")}</p>
          <form action={testMailSettings}>
            <button
              type="submit"
              className={buttonSecondary}
            >
              {t("settings.mailTestRun")}
            </button>
          </form>
        </Card>
      </section>

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
              className={buttonSecondary}
            >
              {t("settings.addTaxRate")}
            </button>
          </form>
        </Card>
      </section>
      {/* Last on the page and quiet about it. This is the one destructive
          action in the system, and it should be findable without being
          something anybody meets on the way to something else. */}
      {session.user.isOwner && (
        <section className="mt-12 border-t border-rule pt-6">
          <h2 className="text-sm font-medium text-muted">{t("settings.demo")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-faint">
            {t("settings.demoHint", {
              items: demo.items,
              batches: demo.batches,
              sales: demo.sales,
            })}
          </p>

          <form
            action={wipeDemoData}
            className="mt-3 flex flex-wrap items-end gap-2"
          >
            <Field label={t("settings.demoConfirm", { phrase: RESET_CONFIRMATION })}>
              <input
                name="confirmation"
                autoComplete="off"
                placeholder={RESET_CONFIRMATION}
                className={`${inputBase} font-mono`}
              />
            </Field>
            <button
              type="submit"
              className="rounded-lg border border-critical/40 px-4 py-2 text-sm text-critical hover:bg-critical-soft"
            >
              {t("settings.demoWipe")}
            </button>
          </form>

          <p className="mt-2 text-xs text-faint">{t("settings.demoKeeps")}</p>
        </section>
      )}
    </>
  );
}
