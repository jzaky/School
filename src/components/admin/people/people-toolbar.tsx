"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { value: string; label: string };
const ALL = "all";
const FILTER_KEYS = ["role", "dept", "grade", "status", "q"] as const;

/** Tabs, filters and search for the people admin. State lives in the URL so views are shareable. */
export function PeopleToolbar({
  tab,
  tabs,
  roles,
  departments,
  grades,
  statuses,
  searchPlaceholder,
}: {
  tab: string;
  tabs: Array<{ value: string; label: string; count: number }>;
  roles?: Option[];
  departments?: Option[];
  grades?: Option[];
  statuses?: Option[];
  searchPlaceholder?: string;
}) {
  const t = useTranslations("adminPeople");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();

  const go = (next: URLSearchParams) => start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    go(next);
  };

  useEffect(() => {
    if ((sp.get("q") ?? "") === q) return;
    const h = setTimeout(() => set("q", q || null), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const switchTab = (value: string) => {
    const next = new URLSearchParams();
    if (value !== tabs[0].value) next.set("tab", value);
    setQ("");
    go(next);
  };
  const hasFilters = FILTER_KEYS.some((k) => sp.get(k));

  const filter = (key: string, label: string, options: Option[] | undefined) =>
    options && options.length > 0 ? (
      <Select value={sp.get(key) ?? ALL} onValueChange={(v) => set(key, v)}>
        <SelectTrigger className="h-9 w-full sm:w-44" aria-label={label} data-testid={`filter-${key}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{label}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-auto" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.value}
              role="tab"
              aria-selected={tab === x.value}
              onClick={() => switchTab(x.value)}
              data-testid={`people-tab-${x.value}`}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === x.value ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {x.label}
              <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{x.count}</span>
            </button>
          ))}
        </div>
        {pending && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label={t("loading")} />}
      </div>
      {(searchPlaceholder || roles || departments || grades || statuses) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {filter("role", t("filterAllRoles"), roles)}
          {filter("dept", t("filterAllDepartments"), departments)}
          {filter("grade", t("filterAllGrades"), grades)}
          {filter("status", t("filterAllStatuses"), statuses)}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = new URLSearchParams();
                const current = sp.get("tab");
                if (current) next.set("tab", current);
                setQ("");
                go(next);
              }}
            >
              <X className="size-4" />
              {t("clearFilters")}
            </Button>
          )}
          {searchPlaceholder && (
            <div className="relative sm:ms-auto sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="ps-9" data-testid="people-search" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
