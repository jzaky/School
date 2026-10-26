"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** From and to dates for the finance reports (kept in the URL so a report view can be shared). */
export function PeriodPicker({ from, to, presets }: { from: string; to: string; presets: Array<{ label: string; from: string; to: string }> }) {
  const t = useTranslations("finance.reports");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [f, setF] = useState(from);
  const [tt, setT] = useState(to);
  const go = (a: string, b: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("from", a);
    next.set("to", b);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:flex-row lg:items-end">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rp-from">{t("from")}</Label>
          <Input id="rp-from" type="date" value={f} max={tt} onChange={(e) => setF(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rp-to">{t("to")}</Label>
          <Input id="rp-to" type="date" value={tt} min={f} onChange={(e) => setT(e.target.value)} className="w-40" />
        </div>
        <Button onClick={() => go(f, tt)} disabled={!f || !tt || f > tt} data-testid="period-apply">
          <CalendarRange className="size-4" />
          {t("apply")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 lg:ms-auto">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setF(p.from);
              setT(p.to);
              go(p.from, p.to);
            }}
            className="rounded-full border bg-card px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
