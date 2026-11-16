"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Chip, inputBase } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { AlertRules, ConfigurableAlert, Thresholds } from "@/lib/alerts/rules";
import { saveAlertRules } from "./actions";

type DayField = "expiringUrgentDays" | "expiringNoticeDays" | "deadStockNoSaleDays" | "deadStockExpiryDays";
type AnyField = DayField | "lowStockDefaultPoint" | "lowStockCoverDays";

const TONE = { warning: "warning", notice: "notice" } as const;
const BAND_FILL = { warning: "bg-warning", notice: "bg-notice" } as const;

/**
 * The four rules a pharmacy may set, one card each.
 *
 * Held in state rather than left to the form so the strip above the cards can
 * redraw as the numbers are typed: "30" and "90" mean little on their own, and
 * a band that visibly swallows the next one is the quickest way to see that a
 * window has been set wider than the one after it. The server validates the
 * same thing again on save -- the strip is an explanation, not the check.
 */
export function RulesForm({ thresholds, rules }: { thresholds: Thresholds; rules: AlertRules }) {
  const t = useTranslations("alertRules");
  const tType = useTranslations("alertType");
  const tSeverity = useTranslations("alertSeverity");

  const [values, setValues] = useState<Record<AnyField, string>>({
    expiringUrgentDays: String(thresholds.expiringUrgentDays),
    expiringNoticeDays: String(thresholds.expiringNoticeDays),
    deadStockNoSaleDays: String(thresholds.deadStockNoSaleDays),
    deadStockExpiryDays: String(thresholds.deadStockExpiryDays),
    lowStockDefaultPoint: String(thresholds.lowStockDefaultPoint),
    lowStockCoverDays: String(thresholds.lowStockCoverDays),
  });
  const [state, setState] = useState(rules);

  const numberOf = (field: AnyField) => Number(values[field].replace(/\D/gu, "") || 0);
  const set = (field: AnyField) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const setRule = (type: ConfigurableAlert, patch: Partial<AlertRules[ConfigurableAlert]>) =>
    setState((current) => ({ ...current, [type]: { ...current[type], ...patch } }));

  const number = (field: AnyField, suffix: string) => (
    <span className="inline-flex items-center gap-2">
      <input
        name={field}
        inputMode="numeric"
        value={values[field]}
        onChange={set(field)}
        aria-label={t(`field.${field}`)}
        className={`${inputBase} tabular w-24 text-right`}
      />
      <span className="text-sm text-muted">{suffix}</span>
    </span>
  );

  /* ---- the strip: who speaks for a batch, by days left ------------------ */

  const urgent = numberOf("expiringUrgentDays");
  const notice = numberOf("expiringNoticeDays");
  const dead = numberOf("deadStockExpiryDays");
  const bands: Array<{
    key: string;
    from: number;
    to: number;
    label: string;
    fill: string;
    /** Drawn fainter: this band only speaks for stock that is also not selling. */
    conditional?: boolean;
  }> = [];
  let edge = 0;
  if (state.expiring_urgent.enabled && urgent > edge) {
    bands.push({
      key: "urgent", from: edge, to: urgent,
      label: tType("expiring_urgent"), fill: BAND_FILL[state.expiring_urgent.severity],
    });
    edge = urgent;
  }
  if (state.expiring_notice.enabled && notice > edge) {
    bands.push({
      key: "notice", from: edge, to: notice,
      label: tType("expiring_notice"), fill: BAND_FILL[state.expiring_notice.severity],
    });
    edge = notice;
  }
  if (state.dead_stock.enabled && dead > edge) {
    bands.push({
      key: "dead", from: edge, to: dead,
      label: t("strip.deadIf", { days: numberOf("deadStockNoSaleDays") }),
      fill: BAND_FILL[state.dead_stock.severity],
      conditional: true,
    });
    edge = dead;
  }
  const span = Math.max(edge, 1);

  const card = (
    type: ConfigurableAlert,
    description: string,
    fields: React.ReactNode,
  ) => {
    const rule = state[type];
    return (
      <Card className={`p-4 sm:p-5 ${rule.enabled ? "" : "opacity-70"}`}>
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name={`enabled_${type}`}
            checked={rule.enabled}
            onChange={(event) => setRule(type, { enabled: event.target.checked })}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{tType(type)}</span>
              {rule.enabled ? (
                <Chip tone={TONE[rule.severity]}>{tSeverity(rule.severity)}</Chip>
              ) : (
                <Chip>{t("off")}</Chip>
              )}
            </span>
            <span className="mt-0.5 block text-sm text-muted">{description}</span>
          </span>
        </label>

        {/* Kept in the form while switched off: a rule turned back on next
            month should come back with the numbers it had. */}
        <div className={`mt-4 flex flex-col gap-4 pl-8 ${rule.enabled ? "" : "hidden"}`}>
          {fields}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground/90">{t("level")}</legend>
            <div className="flex flex-wrap gap-2">
              {(["warning", "notice"] as const).map((severity) => (
                <label
                  key={severity}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${
                    rule.severity === severity ? "border-accent bg-accent-soft" : "border-rule bg-surface"
                  }`}
                >
                  <input
                    type="radio"
                    name={`severity_${type}`}
                    value={severity}
                    checked={rule.severity === severity}
                    onChange={() => setRule(type, { severity })}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${BAND_FILL[severity]}`} />
                  <span>
                    {tSeverity(severity)}
                    <span className="block text-xs text-faint">{t(`levelHint.${severity}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>
    );
  };

  return (
    <form action={saveAlertRules} className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold">{t("strip.title")}</h2>
        <p className="mt-0.5 text-xs text-muted">{t("strip.note")}</p>
        {bands.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("strip.none")}</p>
        ) : (
          <>
            <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              {bands.map((band) => (
                <span
                  key={band.key}
                  className={`${band.fill} h-full ${band.conditional ? "opacity-45" : ""}`}
                  style={{ width: `${((band.to - band.from) / span) * 100}%` }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {bands.map((band) => (
                <li key={band.key} className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${band.fill} ${band.conditional ? "opacity-45" : ""}`}
                  />
                  <span className="tabular shrink-0 text-muted">
                    {t("strip.range", { from: band.from === 0 ? 0 : band.from + 1, to: band.to })}
                  </span>
                  <span className="min-w-0">{band.label}</span>
                </li>
              ))}
              <li className="flex items-baseline gap-2 text-muted">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-rule" />
                <span className="tabular shrink-0">{t("strip.beyond", { days: edge })}</span>
                <span>{t("strip.quiet")}</span>
              </li>
            </ul>
          </>
        )}
      </Card>

      {card(
        "expiring_urgent",
        t("rule.expiring_urgent"),
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span>{t("within")}</span>
          {number("expiringUrgentDays", t("days"))}
        </div>,
      )}

      {card(
        "expiring_notice",
        t("rule.expiring_notice"),
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span>{t("within")}</span>
          {number("expiringNoticeDays", t("days"))}
        </div>,
      )}

      {card(
        "low_stock",
        t("rule.low_stock"),
        <>
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span>{t("defaultPoint")}</span>
              {number("lowStockDefaultPoint", t("units"))}
            </div>
            <p className="mt-1.5 text-xs text-faint">{t("defaultPointHint")}</p>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span>{t("cover")}</span>
              {number("lowStockCoverDays", t("days"))}
            </div>
            <p className="mt-1.5 text-xs text-faint">{t("coverHint")}</p>
          </div>
        </>,
      )}

      {card(
        "dead_stock",
        t("rule.dead_stock"),
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>{t("notSoldFor")}</span>
            {number("deadStockNoSaleDays", t("days"))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>{t("andExpiresWithin")}</span>
            {number("deadStockExpiryDays", t("days"))}
          </div>
        </div>,
      )}

      <div className="sticky bottom-0 -mx-1 bg-background/90 px-1 py-3 backdrop-blur">
        <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
      </div>
    </form>
  );
}
