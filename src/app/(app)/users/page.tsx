import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listUsers } from "@/lib/dal/users";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { Card, Chip, EmptyState, PageHeader, buttonPrimary, buttonSecondarySmall } from "@/components/ui";
import { formatDateTime } from "@/lib/format/date";

export default async function UsersPage() {
  const session = await requirePermission("users.manage");
  const t = await getTranslations();
  const locale = session.user.locale;

  const users = await listUsers();

  return (
    <>
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={
          <Link
            href="/users/new"
            className={buttonPrimary}
          >
            {t("users.new")}
          </Link>
        }
      />

      {users.length === 0 ? (
        <Card className="p-6">
          <EmptyState title={t("users.empty")} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("users.fullName")}</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("users.role")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("users.status")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("users.lastLogin")}
                </th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-rule/60 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/users/${user.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {user.fullName}
                    </Link>
                    <div className="font-mono text-xs text-faint">{user.username}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {user.isOwner ? (
                      <>
                        <Chip tone="accent">{t("users.owner")}</Chip>
                        <div className="mt-1 text-xs text-faint">
                          {t("users.ownerAccess")}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="tabular text-muted">
                          {t("users.permissionCount", {
                            count: user.permissions,
                            total: ALL_PERMISSIONS.length,
                          })}
                        </span>
                        {user.isPharmacist && (
                          <div className="mt-1">
                            <Chip tone="notice">{t("users.pharmacist")}</Chip>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {user.status === "suspended" ? (
                      <Chip tone="critical">{t("users.suspended")}</Chip>
                    ) : (
                      <Chip>{t("users.active")}</Chip>
                    )}
                    {user.mustChangePassword && user.status === "active" && (
                      <div className="mt-1 text-xs text-warning-ink">
                        {t("users.mustChange")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">
                    {user.lastLoginAt
                      ? formatDateTime(user.lastLoginAt, locale)
                      : t("users.never")}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/users/${user.id}`}
                      className={buttonSecondarySmall}
                    >
                      {t("common.edit")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
