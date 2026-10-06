"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Building, Languages, LogOut } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { setLocaleAction, signOutAction } from "@/server/shell/actions";

export type GroupNavItem = { key: "dashboard" | "schools" | "templates" | "platform"; href: string };

export function GroupHeader({ items, userName, roleLabel, backToSchool }: { items: GroupNavItem[]; userName: string; roleLabel: string; backToSchool: boolean }) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const other = locale === "ar" ? "en" : "ar";
  const switchLanguage = () =>
    start(async () => {
      await setLocaleAction(other);
      router.replace(pathname, { locale: other });
      router.refresh();
    });
  const active = (href: string) => (href === "/group" ? pathname === "/group" : pathname.startsWith(href));
  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-brand-foreground">
            <Building className="size-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">{t("areaTitle")}</div>
            <div className="truncate text-xs text-muted-foreground" data-testid="group-user">
              {userName}
              {roleLabel ? ` · ${roleLabel}` : ""}
            </div>
          </div>
        </div>
        <div className="ms-auto flex items-center gap-1">
          {backToSchool && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/home" data-testid="group-back-to-school">
                <ArrowLeft className="size-4 rtl:rotate-180" />
                <span className="hidden sm:inline">{t("backToSchool")}</span>
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={switchLanguage} disabled={pending} aria-label={t("switchLanguage")} data-testid="group-language">
            <Languages className="size-4" />
            <span>{other === "ar" ? tc("arabic") : tc("english")}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => start(() => signOutAction())} aria-label={t("signOut")}>
            <LogOut className="size-4 rtl:rotate-180" />
          </Button>
        </div>
        <nav className="-mx-1 flex w-full gap-1 overflow-x-auto" aria-label={t("areaTitle")}>
          {items.map((i) => (
            <Link
              key={i.key}
              href={i.href}
              data-testid={`group-nav-${i.key}`}
              className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition", active(i.href) ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {t(`nav.${i.key}`)}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
