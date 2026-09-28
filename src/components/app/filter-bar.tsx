"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/** URL-driven tabs, chips and search so filtered views are shareable and server-rendered. */
export function FilterBar({
  tabs,
  chips,
  searchPlaceholder,
  tabParam = "tab",
  chipParam = "status",
}: {
  tabs?: Array<{ value: string; label: string; count?: number }>;
  chips?: Array<{ value: string; label: string }>;
  searchPlaceholder?: string;
  tabParam?: string;
  chipParam?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [, start] = useTransition();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    start(() => router.replace(`${pathname}?${next.toString()}`));
  };

  useEffect(() => {
    if ((sp.get("q") ?? "") === q) return;
    const h = setTimeout(() => set("q", q || null), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const activeTab = sp.get(tabParam) ?? tabs?.[0]?.value;
  const activeChip = sp.get(chipParam) ?? "";
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {tabs && (
        <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 lg:w-auto">
          {tabs.map((t) => (
            <button
              key={t.value}
              onClick={() => set(tabParam, t.value === tabs[0].value ? null : t.value)}
              data-testid={`tab-${t.value}`}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition", activeTab === t.value ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
              {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{t.count}</span>}
            </button>
          ))}
        </div>
      )}
      {chips && (
        <div className="flex gap-1.5 overflow-x-auto">
          {chips.map((c) => (
            <button
              key={c.value}
              onClick={() => set(chipParam, c.value || null)}
              className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition", activeChip === c.value ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {searchPlaceholder && (
        <div className="relative lg:ms-auto lg:w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="ps-9" />
        </div>
      )}
    </div>
  );
}
