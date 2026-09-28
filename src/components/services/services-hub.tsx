"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowUpRight, CalendarClock, Lock, Search, Timer } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/app/empty-state";

export type HubService = {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  featured: boolean;
  sensitivity: string;
  meeting: boolean;
  slaHours: number;
  keywords: string;
};

export function ServicesHub({ services, categories }: { services: HubService[]; categories: Array<{ id: string; name: string }> }) {
  const t = useTranslations("services");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return services.filter((s) => (!cat || s.category === cat) && (!term || s.keywords.toLowerCase().includes(term)));
  }, [services, q, cat]);
  const featured = !q && !cat ? services.filter((s) => s.featured) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-9" data-testid="services-search" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button onClick={() => setCat(null)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition", !cat ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}>
            {t("all")}
          </button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition", cat === c.id ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {featured.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">{t("featured")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((s, i) => (
              <motion.div key={s.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Link
                  href={`/services/${s.key}`}
                  data-testid={`service-${s.key}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-xl border bg-gradient-to-br from-card to-brand-soft/40 p-5 shadow-xs transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-lg bg-brand text-brand-foreground shadow-sm">
                      <Icon name={s.icon} className="size-5" />
                    </span>
                    <ArrowUpRight className="size-4 text-muted-foreground transition group-hover:text-brand rtl:-scale-x-100" />
                  </div>
                  <div className="font-semibold">{s.name}</div>
                  <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted-foreground">{s.description}</p>
                  <Meta s={s} />
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <section>
        {featured.length > 0 && <h2 className="mb-3 text-sm font-semibold">{t("allServices")}</h2>}
        {filtered.length === 0 ? (
          <EmptyState icon={<Search className="size-5" />} title={t("noMatch")} body={t("noMatchBody")} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => (
              <Link
                key={s.key}
                href={`/services/${s.key}`}
                data-testid={featured.length ? undefined : `service-${s.key}`}
                className="group flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs transition hover:border-brand/30 hover:shadow-sm"
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", s.sensitivity === "SAFEGUARDING" ? "bg-danger-soft text-danger" : s.sensitivity === "WELLBEING" ? "bg-violet-50 text-violet-700" : "bg-brand-soft text-brand")}>
                  <Icon name={s.icon} className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium group-hover:text-brand">{s.name}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{s.description}</span>
                  <Meta s={s} small />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Meta({ s, small }: { s: HubService; small?: boolean }) {
  const t = useTranslations("services");
  const turnaround = s.slaHours <= 8 ? t("sameDay") : s.slaHours <= 48 ? t("withinDays", { days: Math.ceil(s.slaHours / 24) }) : t("withinDays", { days: Math.ceil(s.slaHours / 24) });
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground", small ? "mt-2 text-[11px]" : "mt-4 text-xs")}>
      <span className="inline-flex items-center gap-1">
        <Timer className="size-3.5" />
        {turnaround}
      </span>
      {s.meeting && (
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5" />
          {t("includesMeeting")}
        </span>
      )}
      {(s.sensitivity === "WELLBEING" || s.sensitivity === "SAFEGUARDING" || s.sensitivity === "CONFIDENTIAL") && (
        <span className="inline-flex items-center gap-1">
          <Lock className="size-3.5" />
          {t("confidential")}
        </span>
      )}
    </span>
  );
}
