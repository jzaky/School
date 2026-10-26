"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const HREF: Record<string, string> = {
  board: "/admissions",
  applications: "/admissions/applications",
  waitlist: "/admissions/waitlist",
  capacity: "/admissions/capacity",
  registration: "/admissions/registration",
  reenrollment: "/admissions/reenrollment",
  withdrawals: "/admissions/withdrawals",
  reports: "/admissions/reports",
  health: "/admissions/health",
  settings: "/admissions/settings",
};

/** Sub-navigation for the admissions area. Scrolls sideways on a phone. */
export function AdmissionsTabs({ tabs }: { tabs: string[] }) {
  const t = useTranslations("admissions.tabs");
  const path = usePathname();
  const active = (k: string) => (k === "board" ? path === "/admissions" : k === "applications" ? path.startsWith("/admissions/applications") : path.startsWith(HREF[k]));
  return (
    <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8" aria-label={t("label")}>
        {tabs.map((k) => (
          <Link
            key={k}
            href={HREF[k]}
            className={cn("shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition", active(k) ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            aria-current={active(k) ? "page" : undefined}
            data-testid={`adm-tab-${k}`}
          >
            {t(k)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
