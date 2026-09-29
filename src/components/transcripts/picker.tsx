"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/app/badges";
import { searchCoursesAction, type CourseOption } from "@/server/transcripts/actions";
import { CURRICULA } from "@/server/pathway-engine/types";

/** Error toasts for this module (codes from the actions and the engine). */
export function useTxErr() {
  const t = useTranslations("transcripts.errors");
  return (code: string): void => {
    toast.error(t.has(code) ? t(code) : t("generic"));
  };
}

/** Searchable catalog course picker in a dialog. */
export function CoursePickerDialog({
  open,
  onOpenChange,
  curriculum,
  title,
  description,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  curriculum?: string | null;
  title: string;
  description?: string;
  onPick: (c: CourseOption) => void;
}) {
  const t = useTranslations("transcripts");
  const tc = useTranslations("engine.curriculum");
  const locale = useLocale();
  const err = useTxErr();
  const [q, setQ] = useState("");
  const [cur, setCur] = useState<string>(curriculum ?? "ALL");
  const [items, setItems] = useState<CourseOption[] | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open) setCur(curriculum ?? "ALL");
  }, [open, curriculum]);

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(
      () =>
        start(async () => {
          const res = await searchCoursesAction({ q, curriculum: cur === "ALL" ? null : cur });
          if (!res.ok) return err(res.error);
          setItems(res.courses);
        }),
      q ? 250 : 0,
    );
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cur, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("picker.search")} className="ps-9" data-testid="course-search" />
          </div>
          <Select value={cur} onValueChange={setCur}>
            <SelectTrigger className="sm:w-44" aria-label={t("picker.curriculum")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("picker.allCurricula")}</SelectItem>
              {CURRICULA.filter((c) => c !== "OTHER").map((c) => (
                <SelectItem key={c} value={c}>
                  {tc(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-80 min-h-32 overflow-y-auto rounded-lg border">
          {items === null || (pending && !items.length) ? (
            <div className="grid h-32 place-items-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{t("picker.empty")}</p>
          ) : (
            <ul className="divide-y" data-testid="course-results">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-start hover:bg-muted/50"
                    onClick={() => {
                      onPick(c);
                      onOpenChange(false);
                    }}
                    data-testid="course-option"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{locale === "ar" ? c.nameAr : c.nameEn}</span>
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {c.code}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Pill>{tc(c.curriculum)}</Pill>
                      {!c.isGlobal && <Pill tone="brand">{t("picker.schoolCourse")}</Pill>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
