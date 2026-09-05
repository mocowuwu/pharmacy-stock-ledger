import { getTranslations } from "next-intl/server";
import { publicBranding } from "@/lib/dal/settings";
import { Card } from "@/components/ui";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations();
  const branding = await publicBranding();
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : "";
  // Only same-origin paths are carried through, so the sign-in form cannot be
  // used to bounce someone to another site.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "";

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
      {/* A soft accent-tinted glow behind the card -- the sign-in screen has
          nothing else on it, so this is where the reference's depth shows up
          without inventing imagery. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent) 16%, transparent) 0%, transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            {branding.businessName ?? t("app.name")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {branding.businessTagline ?? t("auth.signInTitle")}
          </p>
        </div>
        <Card className="p-6">
          <LoginForm next={next} />
        </Card>
      </div>
    </main>
  );
}
