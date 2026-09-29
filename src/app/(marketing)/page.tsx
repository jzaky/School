import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  Compass,
  FileSignature,
  GraduationCap,
  HeartHandshake,
  Languages,
  LayoutGrid,
  Lock,
  Scale,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Stamp,
  Users,
  Workflow,
} from "lucide-react";
import { Logo } from "@/components/marketing/logo";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { Button } from "@/components/ui/button";
import { signupEnabled } from "@/lib/signup";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("landing");
  return { title: t("metaTitle"), description: t("heroBody") };
}

const FLOWS = [
  { key: "career", icon: Compass, tone: "bg-brand-soft text-brand" },
  { key: "referral", icon: HeartHandshake, tone: "bg-gold-soft text-[oklch(0.5_0.1_80)]" },
  { key: "letter", icon: FileSignature, tone: "bg-success-soft text-success" },
  { key: "subject", icon: Shuffle, tone: "bg-info-soft text-info" },
  { key: "meeting", icon: CalendarClock, tone: "bg-violet-50 text-violet-700" },
] as const;

const ROLES = [
  { key: "students", icon: GraduationCap },
  { key: "parents", icon: Users },
  { key: "teachers", icon: LayoutGrid },
  { key: "counselors", icon: HeartHandshake },
  { key: "dsl", icon: ShieldCheck },
  { key: "leaders", icon: Scale },
] as const;

export default async function Landing() {
  const t = await getTranslations("landing");
  const locale = await getLocale();
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;
  const pilot = signupEnabled();
  const tPilot = await getTranslations("onboarding.landing");
  const steps = (key: string) => [1, 2, 3, 4].map((i) => t(`flows.${key}.s${i}`));

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-transparent bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/" aria-label={t("home")}>
            <Logo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#journeys" className="hover:text-foreground">
              {t("navJourneys")}
            </a>
            <a href="#portals" className="hover:text-foreground">
              {t("navPortals")}
            </a>
            <a href="#trust" className="hover:text-foreground">
              {t("navTrust")}
            </a>
          </nav>
          <div className="flex items-center gap-1.5">
            <MarketingLocaleToggle />
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/login">{t("signIn")}</Link>
            </Button>
            {pilot && (
              <Button variant="outline" size="sm" asChild className="hidden md:inline-flex">
                <Link href="/signup" data-testid="cta-pilot-header">
                  {tPilot("startPilot")}
                </Link>
              </Button>
            )}
            <Button size="sm" asChild>
              <Link href="/demo" data-testid="cta-demo-header">
                {t("tryDemo")}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--brand-soft),transparent_65%)]" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-20">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
                <span className="size-1.5 rounded-full bg-gold" />
                {t("eyebrow")}
              </div>
              <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl">{t("heroTitle")}</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">{t("heroBody")}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" asChild>
                  <Link href="/demo" data-testid="cta-demo">
                    {t("ctaDemo")}
                    <Arrow className="size-4" />
                  </Link>
                </Button>
                {pilot && (
                  <Button size="lg" variant="outline" asChild>
                    <Link href="/signup" data-testid="cta-pilot">
                      {tPilot("startPilot")}
                    </Link>
                  </Button>
                )}
                <Button size="lg" variant="ghost" asChild>
                  <Link href="/login">{t("ctaSignIn")}</Link>
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {(["t1", "t2", "t3"] as const).map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-success" />
                    {t(`trust.${k}`)}
                  </li>
                ))}
              </ul>
            </div>

            {/* Product preview built from real UI patterns */}
            <div className="relative" aria-hidden="true">
              <div className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-brand/10 via-transparent to-gold/15 blur-2xl" />
              <div className="overflow-hidden rounded-2xl border bg-card shadow-xl">
                <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
                  <span className="size-2.5 rounded-full bg-danger/50" />
                  <span className="size-2.5 rounded-full bg-warning/60" />
                  <span className="size-2.5 rounded-full bg-success/60" />
                  <span className="ms-3 text-xs text-muted-foreground">{t("mock.url")}</span>
                </div>
                <div className="space-y-4 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{t("mock.greeting")}</p>
                      <p className="font-semibold">{t("mock.title")}</p>
                    </div>
                    <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-[oklch(0.55_0.14_65)]">{t("mock.approvals")}</span>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{t("mock.request")}</span>
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                        SUB-2026-0041
                      </span>
                    </div>
                    <ol className="mt-4 grid grid-cols-4 gap-2">
                      {[1, 2, 3, 4].map((i) => (
                        <li key={i} className="space-y-1.5">
                          <div className={i <= 2 ? "h-1.5 rounded-full bg-success" : i === 3 ? "h-1.5 rounded-full bg-brand" : "h-1.5 rounded-full bg-muted"} />
                          <p className="truncate text-[11px] text-muted-foreground">{t(`mock.step${i}`)}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border p-3">
                      <p className="text-[11px] text-muted-foreground">{t("mock.meeting")}</p>
                      <p className="mt-1 text-sm font-medium">{t("mock.meetingWhen")}</p>
                    </div>
                    <div className="rounded-xl border p-3">
                      <p className="text-[11px] text-muted-foreground">{t("mock.letter")}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-success">
                        <CheckCircle2 className="size-3.5" />
                        {t("mock.letterReady")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl bg-brand-soft/60 p-3">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
                    <p className="text-xs leading-relaxed text-foreground/80">{t("mock.ai")}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Journeys */}
        <section id="journeys" className="scroll-mt-20 border-t bg-card/50 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-brand">{t("journeysEyebrow")}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t("journeysTitle")}</h2>
              <p className="mt-3 text-muted-foreground">{t("journeysBody")}</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {FLOWS.map(({ key, icon: I, tone }) => (
                <article key={key} className="flex flex-col rounded-2xl border bg-card p-6 shadow-xs">
                  <span className={`grid size-11 place-items-center rounded-xl ${tone}`}>
                    <I className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold">{t(`flows.${key}.title`)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t(`flows.${key}.body`)}</p>
                  <ol className="mt-4 space-y-2 border-s-2 border-dashed ps-4 text-sm">
                    {steps(key).map((s, i) => (
                      <li key={i} className="relative">
                        <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-brand" />
                        {s}
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
              <article className="flex flex-col justify-between rounded-2xl border border-dashed bg-muted/30 p-6">
                <div>
                  <span className="grid size-11 place-items-center rounded-xl bg-card text-muted-foreground shadow-xs">
                    <Workflow className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold">{t("buildTitle")}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t("buildBody")}</p>
                </div>
                <Link href="/demo" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
                  {t("buildCta")}
                  <Arrow className="size-4" />
                </Link>
              </article>
            </div>
          </div>
        </section>

        {/* Portals */}
        <section id="portals" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-brand">{t("portalsEyebrow")}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t("portalsTitle")}</h2>
              <p className="mt-3 text-muted-foreground">{t("portalsBody")}</p>
            </div>
            <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {ROLES.map(({ key, icon: I }) => (
                <div key={key} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-card text-brand shadow-xs">
                    <I className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{t(`roles.${key}.title`)}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`roles.${key}.body`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="scroll-mt-20 bg-[#0f2742] py-20 text-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-[#E9C46A]">{t("trustEyebrow")}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t("trustTitle")}</h2>
              <p className="mt-3 text-white/70">{t("trustBody")}</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                { key: "safeguarding", icon: ShieldCheck },
                { key: "privacy", icon: Lock },
                { key: "ai", icon: Bot },
                { key: "arabic", icon: Languages },
              ].map(({ key, icon: I }) => (
                <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <I className="size-6 text-[#E9C46A]" />
                  <h3 className="mt-4 font-semibold">{t(`pillars.${key}.title`)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{t(`pillars.${key}.body`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <Stamp className="mx-auto size-8 text-brand" />
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance">{t("ctaTitle")}</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{t("ctaBody")}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/demo">
                  {t("ctaDemo")}
                  <Arrow className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <p>{t("footer")}</p>
        </div>
      </footer>
    </div>
  );
}
