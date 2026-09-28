"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, TrendingUp } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type C = { key: string; title: string; cluster: string; summary: string; salary: string; demand: number; keywords: string };

export function ExplorerGrid({ careers }: { careers: C[] }) {
  const t = useTranslations("career");
  const [q, setQ] = useState("");
  const [cluster, setCluster] = useState<string | null>(null);
  const clusters = [...new Set(careers.map((c) => c.cluster))];
  const list = useMemo(() => careers.filter((c) => (!cluster || c.cluster === cluster) && (!q || c.keywords.toLowerCase().includes(q.toLowerCase()))), [careers, q, cluster]);
  return (
    <div className="space-y-5">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchCareers")} className="ps-9" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setCluster(null)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", !cluster ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}>
          {t("allClusters")}
        </button>
        {clusters.map((c) => (
          <button key={c} onClick={() => setCluster(c)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", cluster === c ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}>
            {c}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => (
          <Link key={c.key} href={`/career/explore/${c.key}`} className="group flex flex-col rounded-xl border bg-card p-4 shadow-xs transition hover:border-brand/30 hover:shadow-sm" data-testid={`career-${c.key}`}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.cluster}</div>
            <div className="mt-0.5 font-semibold group-hover:text-brand">{c.title}</div>
            <p className="mt-2 line-clamp-2 flex-1 text-xs text-muted-foreground">{c.summary}</p>
            <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{c.salary}</span>
              <span className="flex items-center gap-1">
                <TrendingUp className="size-3" />
                {"●".repeat(c.demand)}
                <span className="opacity-30">{"●".repeat(5 - c.demand)}</span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
