"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type By = "grade" | "class" | "teacher" | "room";
type Option = { value: string; label: string };

/** Choose what the timetable view shows: a grade, a section, a teacher or a room. */
export function ViewPicker({ by, id, options }: { by: By; id: string; options: Record<By, Option[]> }) {
  const t = useTranslations("timetable");
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (b: By, v?: string) => start(() => router.replace(`/admin/timetable?tab=views&by=${b}${v ? `&id=${encodeURIComponent(v)}` : ""}`, { scroll: false }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist">
        {(["grade", "class", "teacher", "room"] as By[]).map((b) => (
          <button key={b} type="button" role="tab" aria-selected={by === b} onClick={() => go(b)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", by === b ? "bg-brand text-brand-foreground" : "text-muted-foreground")} data-testid={`view-${b}`}>
            {t(`by.${b}`)}
          </button>
        ))}
      </div>
      <Select value={id} onValueChange={(v) => go(by, v)}>
        <SelectTrigger className="w-64 max-w-full" data-testid="view-select">
          <SelectValue placeholder={t("choose")} />
        </SelectTrigger>
        <SelectContent>
          {options[by].map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
