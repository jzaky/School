"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { value: string; label: string };

/** Period (a term, or a custom date range) and scope (school, a grade, a class) for the attendance reports. */
export function ReportFilters({
  terms,
  termId,
  from,
  to,
  custom,
  scopeValue,
  scopeGroups,
}: {
  terms: Option[];
  termId: string | null;
  from: string;
  to: string;
  custom: boolean;
  scopeValue: string;
  scopeGroups: Array<{ label: string; options: Option[] }>;
}) {
  const t = useTranslations("attendance.reports");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [showRange, setShowRange] = useState(custom);
  const [f, setF] = useState(from);
  const [tt, setTt] = useState(to);

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3 shadow-xs">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("period")}>
          {terms.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setShowRange(false);
                push({ term: o.value, from: null, to: null });
              }}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", !custom && termId === o.value ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}
              data-testid="term-chip"
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowRange((s) => !s)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", custom || showRange ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}
            data-testid="custom-range"
          >
            {t("customRange")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Select value={scopeValue} onValueChange={(v) => push({ scope: v === "school" ? null : v, student: null })}>
            <SelectTrigger className="w-full sm:w-72" aria-label={t("scope")} data-testid="scope-picker">
              <SelectValue placeholder={t("scopePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {scopeGroups.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </div>
      {showRange && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (f && tt && f <= tt) push({ from: f, to: tt, term: null });
          }}
        >
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("from")}
            <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="h-9 w-40" dir="ltr" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("to")}
            <Input type="date" value={tt} onChange={(e) => setTt(e.target.value)} className="h-9 w-40" dir="ltr" />
          </label>
          <Button type="submit" size="sm" disabled={!f || !tt || f > tt}>
            {t("apply")}
          </Button>
        </form>
      )}
    </div>
  );
}
