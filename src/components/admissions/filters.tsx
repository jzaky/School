"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { selectClass } from "./ui";

type Opt = { value: string; label: string };

/** URL-driven filters for the admissions pages: year, grade, a flag chip and search. Changing a filter resets paging. */
export function AdmissionFilters({ year, years, grades, flags, stages, search = true }: { year?: string; years: Opt[]; grades: Opt[]; flags?: Opt[]; stages?: Opt[]; search?: boolean }) {
  const t = useTranslations("admissions.filters");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [, start] = useTransition();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  };
  useEffect(() => {
    if ((sp.get("q") ?? "") === q) return;
    const h = setTimeout(() => set("q", q.trim() || null), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const flag = sp.get("flag") ?? "";
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <select aria-label={t("year")} className={cn(selectClass, "h-9 sm:w-40")} value={year || (sp.get("year") ?? years[0]?.value ?? "")} onChange={(e) => set("year", e.target.value)} data-testid="filter-year">
          {years.map((y) => (
            <option key={y.value} value={y.value}>
              {y.label}
            </option>
          ))}
        </select>
        {grades.length > 0 && (
          <select aria-label={t("grade")} className={cn(selectClass, "h-9 sm:w-40")} value={sp.get("grade") ?? ""} onChange={(e) => set("grade", e.target.value || null)} data-testid="filter-grade">
            <option value="">{t("allGrades")}</option>
            {grades.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        )}
        {stages && (
          <select aria-label={t("stage")} className={cn(selectClass, "col-span-2 h-9 sm:w-48")} value={sp.get("stage") ?? ""} onChange={(e) => set("stage", e.target.value || null)} data-testid="filter-stage">
            <option value="">{t("allStages")}</option>
            {stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {flags && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {[{ value: "", label: t("allFlags") }, ...flags].map((f) => (
            <button key={f.value} type="button" onClick={() => set("flag", f.value || null)} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition", flag === f.value ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")} data-testid={`flag-${f.value || "all"}`}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      {search && (
        <div className="relative lg:ms-auto lg:w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="h-9 ps-9" data-testid="filter-search" />
        </div>
      )}
    </div>
  );
}

/** Previous and next page links for long lists. */
export function Pager({ page, total, perPage }: { page: number; total: number; perPage: number }) {
  const t = useTranslations("admissions.filters");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const go = (p: number) => {
    const next = new URLSearchParams(sp.toString());
    if (p > 1) next.set("page", String(p));
    else next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-sm" data-testid="pager">
      <button type="button" className="rounded-md border bg-card px-3 py-1.5 disabled:opacity-50" disabled={page <= 1} onClick={() => go(page - 1)}>
        {t("previous")}
      </button>
      <span className="text-muted-foreground tabular-nums">{t("pageOf", { page, pages, total })}</span>
      <button type="button" className="rounded-md border bg-card px-3 py-1.5 disabled:opacity-50" disabled={page >= pages} onClick={() => go(page + 1)}>
        {t("next")}
      </button>
    </div>
  );
}
