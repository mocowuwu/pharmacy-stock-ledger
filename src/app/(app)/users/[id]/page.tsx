import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { getUser } from "@/lib/dal/users";
import { Alert, Card, Chip, PageHeader, buttonPrimary, buttonSecondary } from "@/components/ui";
import { formatDateTime } from "@/lib/format/date";
import { changeStatus, signOutEverywhere } from "../actions";
import { EditUserForm } from "./EditUserForm";

export default async function UserPage({
  params,
  searchParams,
}: PageProps<"/users/[id]">) {
  const session = await requirePermission("users.manage");
  const t = await getTranslations();
  const { id } = await params;
  const query = await searchParams;

  const user = await getUser(id);
  if (!user) notFound();

  const locale = session.user.locale;
  const isSelf = user.id === session.user.id;

  return (
    <>
      <PageHeader
        title={user.fullName}
        subtitle={user.username}
        actions={
          user.status === "suspended" ? (
            <Chip tone="critical">{t("users.suspended")}</Chip>
          ) : (
            <Chip>{t("users.active")}</Chip>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {typeof query.error === "string" && (
          <Alert>{t(`errors.${query.error}`)}</Alert>
        )}
        {query.status === "suspended" && (
          <Alert tone="warning">{t("users.suspended")}</Alert>
        )}
        {query.status === "active" && (
          <Alert tone="notice">{t("users.active")}</Alert>
        )}
        {typeof query.revoked === "string" && (
          <Alert tone="notice">
            {t("users.sessionsRevoked", { count: query.revoked })}
          </Alert>
        )}
        {user.lockedUntil && user.lockedUntil > new Date() && (
          <Alert tone="warning">
            {t("users.lockedOut", { time: formatDateTime(user.lockedUntil, locale) })}
          </Alert>
        )}
        {user.mustChangePassword && (
          <Alert tone="notice">{t("users.mustChange")}</Alert>
        )}
      </div>

      <EditUserForm
        user={{
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          locale: user.locale,
          isOwner: user.isOwner,
          isPharmacist: user.isPharmacist,
          sipaNumber: user.sipaNumber,
          straNumber: user.straNumber,
          permissions: user.permissions,
        }}
      />

      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-medium">{t("users.status")}</h2>
          <p className="mt-1 text-sm text-muted">
            {user.activeSessions > 0
              ? t("users.activeSessions", { count: user.activeSessions })
              : t("users.suspendHint")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user.activeSessions > 0 && (
            <form action={signOutEverywhere}>
              <input type="hidden" name="userId" value={user.id} />
              <button
                type="submit"
                className={buttonSecondary}
              >
                {t("users.revokeSessions")}
              </button>
            </form>
          )}

          {/* The owner cannot be suspended and nobody may suspend themselves.
              The server refuses both regardless; not offering the button is
              the courtesy on top. */}
          {user.status === "active" ? (
            !user.isOwner &&
            !isSelf && (
              <form action={changeStatus}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="status" value="suspended" />
                <button
                  type="submit"
                  className="rounded-lg border border-critical/40 px-4 py-2 text-sm text-critical hover:bg-critical-soft"
                >
                  {t("users.suspend")}
                </button>
              </form>
            )
          ) : (
            <form action={changeStatus}>
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="status" value="active" />
              <button
                type="submit"
                className={buttonPrimary}
              >
                {t("users.reactivate")}
              </button>
            </form>
          )}
        </div>
      </Card>

      {isSelf && !user.isOwner && (
        <p className="mt-3 text-sm text-muted">{t("users.cannotEditOwn")}</p>
      )}
    </>
  );
}
