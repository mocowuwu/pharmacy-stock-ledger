"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  PERMISSION_GROUPS,
  PERMISSION_TEMPLATES,
  SENSITIVE_PERMISSIONS,
  type PermissionTemplate,
} from "@/lib/auth/permissions";
import { Alert, Card, Field, SectionHeading, inputClass } from "@/components/ui";

const TEMPLATES: Array<{ key: PermissionTemplate | "blank"; label: string }> = [
  { key: "blank", label: "templateBlank" },
  { key: "cashier", label: "templateCashier" },
  { key: "stock_clerk", label: "templateStockClerk" },
  { key: "manager", label: "templateManager" },
];

/**
 * The permission grid.
 *
 * A template ticks a starting set and then gets out of the way -- the owner
 * asked for permissions to be flexible per person, so the boxes stay editable
 * afterwards and the template is never stored as a role. Picking one again
 * replaces the ticks, which is the only way it can behave without a second
 * hidden state to explain.
 */
export function PermissionPicker({
  initial,
  showTemplates = false,
}: {
  initial: readonly string[];
  showTemplates?: boolean;
}) {
  const t = useTranslations();
  const [granted, setGranted] = useState<Set<string>>(new Set(initial));

  const toggle = (permission: string) =>
    setGranted((previous) => {
      const next = new Set(previous);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });

  const applyTemplate = (key: PermissionTemplate | "blank") =>
    setGranted(new Set(key === "blank" ? [] : PERMISSION_TEMPLATES[key]));

  const sensitive = (SENSITIVE_PERMISSIONS as readonly string[]).filter((p) =>
    granted.has(p),
  );

  return (
    <div className="flex flex-col gap-4">
      {showTemplates && (
        <Field label={t("users.template")} hint={t("users.templateHint")}>
          <select
            defaultValue="blank"
            onChange={(event) =>
              applyTemplate(event.target.value as PermissionTemplate | "blank")
            }
            className={inputClass}
          >
            {TEMPLATES.map((template) => (
              <option key={template.key} value={template.key}>
                {t(`users.${template.label}`)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div>
        <SectionHeading>{t("users.permissions")}</SectionHeading>
        <p className="mb-3 -mt-1 text-sm text-muted">{t("users.permissionsHint")}</p>

        {sensitive.length > 0 && (
          <Alert tone="warning" className="mb-3">
            {t("users.sensitiveWarning")}
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
            <Card key={group} className="px-5 py-4">
              <h3 className="mb-2 text-sm font-medium text-muted">
                {t(`permissionGroup.${group}`)}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {permissions.map((permission) => {
                  const isSensitive = (
                    SENSITIVE_PERMISSIONS as readonly string[]
                  ).includes(permission);
                  return (
                    <li key={permission}>
                      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                        <input
                          type="checkbox"
                          name="permissions"
                          value={permission}
                          checked={granted.has(permission)}
                          onChange={() => toggle(permission)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span>
                          {t(`permission.${permission}`)}
                          {isSensitive && (
                            <span className="ml-1.5 text-xs text-warning-ink">•</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>

        {granted.size === 0 && (
          <p className="mt-3 text-sm text-warning-ink">{t("users.noPermissions")}</p>
        )}
      </div>
    </div>
  );
}
