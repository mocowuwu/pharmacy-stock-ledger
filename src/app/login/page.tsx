import { getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations();
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : "";
  // Only same-origin paths are carried through, so the sign-in form cannot be
  // used to bounce someone to another site.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">{t("app.name")}</h1>
          <p className="mt-1 text-sm text-muted">{t("auth.signInTitle")}</p>
        </div>
        <div className="rounded-xl border border-rule bg-surface p-6 shadow-[0_1px_2px_rgba(23,20,31,0.04)]">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
