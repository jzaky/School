import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { listDemoPersonas } from "@/server/demo/personas";
import { PersonaGrid } from "@/components/marketing/persona-grid";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { Logo } from "@/components/marketing/logo";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const locale = await getLocale();
  const t = await getTranslations("demo");
  const { org, personas } = await listDemoPersonas(locale);
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,var(--brand-soft),transparent_60%)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
        </Link>
        <MarketingLocaleToggle />
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <div className="mb-10 max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            {t("liveBadge")}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
          <p className="mt-3 text-lg text-muted-foreground">{t("subtitle", { school: org?.name ?? "" })}</p>
        </div>
        {personas.length ? (
          <PersonaGrid personas={personas} />
        ) : (
          <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">{t("unavailable")}</div>
        )}
        <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-success" />
          {t("fictional")}
        </p>
      </main>
    </div>
  );
}
