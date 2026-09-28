import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listDevices } from "@/lib/dal/offline";
import { Alert, Card, Chip, EmptyState, PageHeader, buttonSecondary, buttonSecondarySmall } from "@/components/ui";
import { formatDateTime } from "@/lib/format/date";
import { revokeDeviceAction } from "./actions";

/**
 * The phones and tablets running the Android app.
 *
 * A device appears here the first time someone signs in on it; there is no
 * pairing step, because only devices on the pharmacy's Tailscale network can
 * reach the server at all. Revoking is for a phone that is lost or retired.
 */
export default async function DevicesPage({ searchParams }: PageProps<"/users/devices">) {
  const session = await requirePermission("users.manage");
  const t = await getTranslations();
  const query = await searchParams;
  const locale = session.user.locale;
  const list = await listDevices();

  return (
    <>
      <PageHeader
        title={t("devices.title")}
        subtitle={t("devices.subtitle")}
        actions={
          <Link href="/users" className={buttonSecondary}>
            {t("users.backToList")}
          </Link>
        }
      />
      {query.revoked && (
        <div className="mb-4">
          <Alert tone="notice">{t("devices.revoked")}</Alert>
        </div>
      )}

      {list.length === 0 ? (
        <Card className="p-6">
          <EmptyState title={t("devices.empty")} body={t("devices.emptyHint")} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("devices.name")}</th>
                <th className="px-4 py-2.5 font-medium">{t("devices.role")}</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t("devices.lastSeen")}</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t("devices.lastSync")}</th>
                <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{t("devices.offlineSales")}</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {list.map((device) => (
                <tr key={device.id} className="border-b border-rule/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{device.name}</div>
                    <div className="font-mono text-xs text-faint">
                      {device.code}
                      {device.appVersion ? ` · v${device.appVersion}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Chip tone={device.role === "till" ? "accent" : "neutral"}>
                      {t(`devices.roles.${device.role}`)}
                    </Chip>
                  </td>
                  <td className="tabular px-4 py-3 text-xs text-muted">
                    {formatDateTime(device.lastSeenAt, locale)}
                  </td>
                  <td className="tabular px-4 py-3 text-xs text-muted">
                    {device.lastSyncAt ? formatDateTime(device.lastSyncAt, locale) : "—"}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{device.offlineSales}</td>
                  <td className="px-4 py-3 text-right">
                    {device.revokedAt ? (
                      <Chip tone="critical">{t("devices.revokedChip")}</Chip>
                    ) : (
                      <form action={revokeDeviceAction}>
                        <input type="hidden" name="deviceId" value={device.id} />
                        <button type="submit" className={buttonSecondarySmall}>
                          {t("devices.revoke")}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-4 text-xs text-faint">{t("devices.revokeHint")}</p>
    </>
  );
}
