"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowRight, Building, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { signInAsPersonaAction } from "@/server/shell/actions";
import { GROUP_PERSONA } from "@/server/demo/constants";

type Persona = { key: string; name: string; initials: string; role: string; blurb: string; primary: boolean };

const TONES: Record<string, string> = {
  admin: "from-sky-500/15 to-sky-500/5 text-sky-700",
  principal: "from-indigo-500/15 to-indigo-500/5 text-indigo-700",
  teacher: "from-emerald-500/15 to-emerald-500/5 text-emerald-700",
  counselor: "from-cyan-500/15 to-cyan-500/5 text-cyan-700",
  career_advisor: "from-violet-500/15 to-violet-500/5 text-violet-700",
  dsl: "from-rose-500/15 to-rose-500/5 text-rose-700",
  student: "from-amber-500/15 to-amber-500/5 text-amber-700",
  parent: "from-teal-500/15 to-teal-500/5 text-teal-700",
};

export function PersonaGrid({ personas }: { personas: Persona[] }) {
  const t = useTranslations("demo");
  const locale = useLocale();
  const [active, setActive] = useState<string | null>(null);
  const [, start] = useTransition();
  const enter = (key: string) => {
    setActive(key);
    start(async () => {
      const res = await signInAsPersonaAction(key, locale);
      if (res && !res.ok) setActive(null);
    });
  };
  const primary = personas.filter((p) => p.primary);
  const more = personas.filter((p) => !p.primary && p.key !== GROUP_PERSONA);
  const group = personas.find((p) => p.key === GROUP_PERSONA);
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {primary.map((p, i) => (
          <motion.button
            key={p.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => enter(p.key)}
            disabled={active !== null}
            data-testid={`enter-${p.key}`}
            className="group relative flex flex-col rounded-xl border bg-card p-5 text-start shadow-xs transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md disabled:opacity-70"
          >
            <div className={cn("mb-4 grid size-11 place-items-center rounded-full bg-gradient-to-br text-sm font-semibold", TONES[p.key])}>{p.initials}</div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.role}</div>
            <div className="mt-0.5 text-base font-semibold">{p.name}</div>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{p.blurb}</p>
            <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-brand">
              {active === p.key ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("enterAs")}
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
            </div>
          </motion.button>
        ))}
      </div>
      {group && (
        <button
          onClick={() => enter(group.key)}
          disabled={active !== null}
          data-testid={`enter-${group.key}`}
          className="group flex w-full flex-col gap-4 rounded-xl border bg-card p-5 text-start shadow-xs transition hover:border-brand/30 hover:shadow-md disabled:opacity-70 sm:flex-row sm:items-center"
        >
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-500/15 to-slate-500/5 text-slate-700">
            {active === group.key ? <Loader2 className="size-4 animate-spin" /> : <Building className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("groupHeading")}</div>
            <div className="mt-0.5 text-base font-semibold">
              {group.name} <span className="font-normal text-muted-foreground">· {group.role}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{group.blurb}</p>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-brand">
            {t("enterAs")}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </div>
        </button>
      )}
      {more.length > 0 && (
        <div>
          <div className="mb-3 text-sm font-medium text-muted-foreground">{t("morePeople")}</div>
          <div className="flex flex-wrap gap-2">
            {more.map((p) => (
              <button
                key={p.key}
                onClick={() => enter(p.key)}
                disabled={active !== null}
                data-testid={`enter-${p.key}`}
                className="flex items-center gap-2 rounded-full border bg-card py-1.5 pe-4 ps-1.5 text-sm transition hover:border-brand/30 hover:shadow-sm disabled:opacity-70"
              >
                <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
                  {active === p.key ? <Loader2 className="size-3.5 animate-spin" /> : p.initials}
                </span>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">{p.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
