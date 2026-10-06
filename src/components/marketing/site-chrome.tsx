import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/marketing/logo";
import { MarketingLocaleToggle } from "@/components/marketing/locale-toggle";
import { Button } from "@/components/ui/button";
import { signupEnabled } from "@/lib/signup";
import { cn } from "@/lib/utils";

type Active = "home" | "pricing" | "try" | "status";

/** Header for the public site. On the landing page the section links scroll; elsewhere they go back to it. */
export async function SiteHeader({ active = "home" }: { active?: Active }) {
  const t = await getTranslations("landing");
  const g = await getTranslations("growth.site");
  const tPilot = await getTranslations("onboarding.landing");
  const pilot = signupEnabled();
  const anchor = (id: string) => (active === "home" ? `#${id}` : `/#${id}`);
  const link = (is: boolean) => cn("hover:text-foreground", is && "font-medium text-foreground");
  return (
    <header className="sticky top-0 z-30 border-b border-transparent bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" aria-label={t("home")}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
          <a href={anchor("journeys")} className={link(false)}>
            {t("navJourneys")}
          </a>
          <a href={anchor("portals")} className={link(false)}>
            {t("navPortals")}
          </a>
          <a href={anchor("trust")} className={link(false)}>
            {t("navTrust")}
          </a>
          <Link href="/try" className={link(active === "try")} data-testid="nav-try">
            {g("taster")}
          </Link>
          <Link href="/pricing" className={link(active === "pricing")} data-testid="nav-pricing">
            {g("pricing")}
          </Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <MarketingLocaleToggle />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex lg:hidden">
            <Link href="/pricing">{g("pricing")}</Link>
          </Button>
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
  );
}

export async function SiteFooter() {
  const t = await getTranslations("landing");
  const g = await getTranslations("growth.site");
  const links = [
    { href: "/try", label: g("taster"), id: "footer-try" },
    { href: "/pricing", label: g("pricing"), id: "footer-pricing" },
    { href: "/demo", label: t("tryDemo"), id: "footer-demo" },
    { href: "/status", label: g("status"), id: "footer-status" },
    { href: "/login", label: t("signIn"), id: "footer-login" },
  ];
  return (
    <footer className="border-t py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <Logo />
        <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label={g("footerNav")}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground" data-testid={l.id}>
              {l.label}
            </Link>
          ))}
        </nav>
        <p>{t("footer")}</p>
      </div>
    </footer>
  );
}
