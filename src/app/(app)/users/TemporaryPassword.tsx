"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, Card, buttonPrimary } from "@/components/ui";

/**
 * The one-time password, shown once.
 *
 * Deliberately plain and hard to miss. There is no copy button and no way to
 * ask for it again: the owner issues a temporary password and never learns the
 * working one, which is what lets a sale be attributed honestly to the cashier
 * who rang it. If it is lost, the answer is to issue another.
 */
export function TemporaryPassword({
  username,
  fullName,
  password,
  done,
}: {
  username: string;
  fullName: string;
  password: string;
  done: { href: string; label?: string };
}) {
  const t = useTranslations();

  return (
    <Card className="p-6">
      <h2 className="font-medium">{t("users.passwordTitle", { username })}</h2>

      <div className="my-4 rounded-lg border border-accent/40 bg-accent-soft px-5 py-4 text-center">
        <span className="tabular font-mono text-2xl font-semibold tracking-wide text-accent select-all">
          {password}
        </span>
      </div>

      <Alert tone="warning">{t("users.passwordBody", { name: fullName })}</Alert>

      <Link
        href={done.href}
        className={`mt-4 ${buttonPrimary}`}
      >
        {done.label ?? t("users.passwordDone")}
      </Link>
    </Card>
  );
}
