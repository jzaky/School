"use client";
import * as React from "react";
import Link from "next/link";
import { Languages, LogOut, ShieldCheck, User } from "lucide-react";
import { useT } from "@/components/region-provider";
import { setLocaleAction } from "@/server/actions/locale";
import { logoutAction } from "@/server/actions/auth";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ShellData } from "./types";

export function UserMenu({ data }: { data: ShellData }) {
  const { t, locale } = useT();
  const initials = data.user.name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account menu" className="inline-flex h-8 items-center gap-2 rounded-md px-1.5 text-sm text-fg transition-colors duration-150 hover:bg-bg-elev-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-bg-elev-2 text-[11px] font-semibold text-fg-muted">{initials || <User className="h-3.5 w-3.5" aria-hidden />}</span>
          <span className="hidden max-w-[140px] truncate md:inline">{data.user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[240px]">
        <div className="px-2 py-2">
          <div className="truncate text-sm font-medium text-fg">{data.user.name}</div>
          <div className="truncate text-xs text-fg-muted">{data.user.email}</div>
          <div className="mt-1 text-xs text-fg-dim">{data.roleName ?? (data.user.isPlatformAdmin ? "Platform administrator" : "No role")}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/security">
            <ShieldCheck className="h-4 w-4 text-fg-muted" aria-hidden />
            {t("shell.account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="language-switch"
          onSelect={async () => {
            const r = await setLocaleAction(locale === "ar" ? "en" : "ar");
            // A full reload: the direction and every server-rendered text change at once, and no cached
            // router state can keep the old language.
            if (r.ok) window.location.reload();
          }}
        >
          <Languages className="h-4 w-4 text-fg-muted" aria-hidden />
          <span lang={locale === "ar" ? "en" : "ar"}>{locale === "ar" ? t("shell.switchToEnglish") : t("shell.switchToArabic")}</span>
        </DropdownMenuItem>
        {locale === "ar" ? <p className="px-2 pb-1 text-[11px] leading-snug text-fg-dim">{t("shell.partialArabic")}</p> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logoutAction()}>
          <LogOut className="h-4 w-4 text-fg-muted" aria-hidden />
          {t("shell.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
