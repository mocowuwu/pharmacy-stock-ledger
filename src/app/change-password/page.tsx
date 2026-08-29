import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function ChangePasswordPage() {
  const session = await requireSession({ allowPendingPasswordChange: true });
  const t = await getTranslations("auth");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("changePasswordTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted">{t("changePasswordIntro")}</p>
          <p className="mt-2 text-sm text-faint">{session.user.fullName}</p>
        </div>
        <div className="rounded-xl border border-rule bg-surface p-6 shadow-[0_1px_2px_rgba(23,20,31,0.04)]">
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  );
}
