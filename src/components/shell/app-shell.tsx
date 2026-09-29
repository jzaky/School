"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bell, ChevronsUpDown, Languages, LogOut, Menu, RotateCcw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommandPalette } from "./command-palette";
import { NotificationsBell } from "./notifications-bell";
import { setLocaleAction, signInAsPersonaAction, signOutAction } from "@/server/shell/actions";
import { resetDemoAction } from "@/server/demo/reset";
import type { NavSection } from "@/server/shell/nav";
import { SchoolSwitcherItems } from "@/components/access/school-switcher";

export type ShellProps = {
  nav: NavSection[];
  user: { name: string; initials: string; roleLabel: string; email: string };
  org: { name: string; short: string; hasLogo?: boolean; logoVersion?: number };
  demo: { enabled: boolean; current: string | null; personas: Array<{ key: string; label: string; name: string; initials: string }> };
  unread: number;
  schools?: Array<{ id: string; name: string; current: boolean }>;
  children: React.ReactNode;
};

function isActive(pathname: string, href: string) {
  if (href === "/home") return pathname === "/home" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarContent({ nav, org, onNavigate }: Pick<ShellProps, "nav" | "org"> & { onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  // Only the most specific matching item is active (so /career/pathways does not also light up /career).
  const hrefs = nav.flatMap((section) => section.items.map((item) => item.href));
  const best = hrefs.filter((href) => isActive(pathname, href)).sort((a, b) => b.length - a.length)[0];
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 px-5">
        {org.hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/org/logo?v=${org.logoVersion ?? 0}`} alt="" className="size-9 rounded-lg bg-white object-contain p-0.5 shadow-sm" />
        ) : (
          <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-gold to-[oklch(0.62_0.12_70)] text-sm font-bold text-sidebar shadow-sm">
            {Array.from(org.short.trim())[0]?.toUpperCase() ?? ""}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{org.short}</div>
          <div className="truncate text-xs text-sidebar-muted">{org.name}</div>
        </div>
      </div>
      <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-2">
        {nav.map((section) => (
          <div key={section.key}>
            <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{t(section.key)}</div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.href === best;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-white shadow-[inset_2px_0_0_var(--gold)] rtl:shadow-[inset_-2px_0_0_var(--gold)]"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                      )}
                    >
                      <Icon name={item.icon} className={cn("size-4 shrink-0", active ? "text-gold" : "text-sidebar-muted group-hover:text-sidebar-foreground")} />
                      <span className="flex-1 truncate">{t(item.key)}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-gold/90 px-1.5 text-[11px] font-semibold leading-5 text-sidebar tabular-nums">{item.badge}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

export function AppShell({ nav, user, org, demo, unread, schools = [], children }: ShellProps) {
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const other = locale === "ar" ? "en" : "ar";

  const switchLanguage = () => {
    startTransition(async () => {
      await setLocaleAction(other);
      router.replace(pathname, { locale: other });
      router.refresh();
    });
  };

  const switchPersona = (key: string) => {
    startTransition(async () => {
      await signInAsPersonaAction(key, locale);
    });
  };

  const resetDemo = () => {
    const id = toast.loading(t("resetting"));
    startTransition(async () => {
      const res = await resetDemoAction();
      setResetOpen(false);
      if (res.ok) {
        toast.success(t("resetDone"), { id });
        router.push("/home");
        router.refresh();
      } else {
        toast.error(tc("somethingWrong"), { id });
      }
    });
  };

  const currentPersona = demo.personas.find((p) => p.key === demo.current);

  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-sidebar-border lg:block">
        <SidebarContent nav={nav} org={org} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="start" className="w-72 border-0 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">{t("openMenu")}</SheetTitle>
          <SidebarContent nav={nav} org={org} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col lg:ps-64">
        {demo.enabled && (
          <div className="flex items-center gap-2 border-b border-gold/30 bg-gold-soft px-4 py-1.5 text-xs text-[oklch(0.42_0.08_80)] sm:px-6">
            <Sparkles className="size-3.5 shrink-0" />
            <span className="hidden truncate sm:inline">{t("demoBanner")}</span>
            <div className="ms-auto flex shrink-0 items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium hover:bg-gold/15 disabled:opacity-60"
                    disabled={pending}
                    data-testid="persona-switcher"
                  >
                    <span className="text-[oklch(0.5_0.06_80)]">{t("viewingAs")}</span>
                    <span>{currentPersona ? currentPersona.name : user.name}</span>
                    <ChevronsUpDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>{t("switchPersona")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {demo.personas.map((p) => (
                    <DropdownMenuItem key={p.key} onSelect={() => switchPersona(p.key)} data-testid={`persona-${p.key}`} className="gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{p.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.label}</span>
                      </span>
                      {p.key === demo.current && <span className="size-2 rounded-full bg-success" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => setResetOpen(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1 font-medium hover:bg-gold/15"
                data-testid="reset-demo"
              >
                <RotateCcw className="size-3" />
                <span className="hidden sm:inline">{t("resetDemo")}</span>
              </button>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("openMenu")}>
            <Menu className="size-5" />
          </Button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground shadow-xs transition hover:border-ring/40"
            data-testid="open-palette"
          >
            <Search className="size-4" />
            <span className="flex-1 truncate text-start">{t("search")}</span>
            <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline" dir="ltr">
              Ctrl K
            </kbd>
          </button>
          <div className="ms-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={switchLanguage} disabled={pending} aria-label={t("switchLanguage")} data-testid="language-toggle" className="gap-1.5">
              <Languages className="size-4" />
              <span className={other === "ar" ? "hidden font-arabic sm:inline" : "hidden sm:inline"}>{other === "ar" ? "العربية" : "English"}</span>
            </Button>
            <NotificationsBell unread={unread} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ms-1 grid size-8 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-foreground ring-2 ring-background" aria-label={t("profile")} data-testid="user-menu">
                  {user.initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{user.roleLabel}</div>
                  <div className="truncate text-xs text-muted-foreground" dir="ltr">
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">{t("profile")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/notifications">
                    <Bell className="size-4" />
                    {t("notifications")}
                  </Link>
                </DropdownMenuItem>
                {schools.length > 1 && <SchoolSwitcherItems schools={schools} />}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => startTransition(() => signOutAction())}>
                  <LogOut className="size-4" />
                  {t("signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} nav={nav} />

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resetDemo")}</DialogTitle>
            <DialogDescription>{t("resetDemoConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button onClick={resetDemo} disabled={pending} data-testid="confirm-reset">
              {pending ? t("resetting") : t("resetDemo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
