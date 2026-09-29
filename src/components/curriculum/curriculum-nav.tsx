"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Section tabs for the curriculum area. Only tabs the member can use are passed in. */
export function CurriculumNav({ tabs, reviewCount }: { tabs: Array<"coverage" | "plans" | "review" | "frameworks">; reviewCount?: number }) {
  const t = useTranslations("curriculum.nav");
  const pathname = usePathname();
  const href = { coverage: "/curriculum", plans: "/curriculum/plans", review: "/curriculum/review", frameworks: "/curriculum/frameworks" } as const;
  const active = (k: keyof typeof href) => (k === "coverage" ? pathname === "/curriculum" : pathname.startsWith(href[k]));
  return (
    <nav className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-auto" aria-label={t("label")}>
      {tabs.map((k) => (
        <Link
          key={k}
          href={href[k]}
          data-testid={`curriculum-tab-${k}`}
          className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition", active(k) ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {t(k)}
          {k === "review" && reviewCount ? <span className="rounded-full bg-brand px-1.5 text-[11px] tabular-nums text-white">{reviewCount}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
