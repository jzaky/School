"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createYearAction, setCurrentYearAction } from "@/server/calendar/admin-actions";
import { Field, useActionError } from "./shared";

type TermRow = { nameEn: string; nameAr: string; startsOn: string; endsOn: string };

/** Suggested dates for the next year: late August to early July with three terms. */
function defaults(startYear: number) {
  const y = startYear;
  return {
    nameEn: `${y}-${y + 1}`,
    nameAr: `${y}-${y + 1}`,
    startsOn: `${y}-08-24`,
    endsOn: `${y + 1}-07-02`,
    terms: [
      { nameEn: "Autumn term", nameAr: "الفصل الأول", startsOn: `${y}-08-24`, endsOn: `${y}-12-11` },
      { nameEn: "Spring term", nameAr: "الفصل الثاني", startsOn: `${y + 1}-01-04`, endsOn: `${y + 1}-03-26` },
      { nameEn: "Summer term", nameAr: "الفصل الثالث", startsOn: `${y + 1}-04-12`, endsOn: `${y + 1}-07-02` },
    ] as TermRow[],
  };
}

export function NewYearDialog({ nextStartYear }: { nextStartYear: number }) {
  const t = useTranslations("calendarAdmin");
  const tc = useTranslations("common");
  const err = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(defaults(nextStartYear));
  const [makeCurrent, setMakeCurrent] = useState(false);
  const [pending, start] = useTransition();
  const setTerm = (i: number, patch: Partial<TermRow>) => setF((p) => ({ ...p, terms: p.terms.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const submit = () =>
    start(async () => {
      const res = await createYearAction({ ...f, makeCurrent });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("yearCreated", { name: f.nameEn }));
      setOpen(false);
      router.push(`/admin/calendar?year=${res.id}`);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" onClick={() => (setF(defaults(nextStartYear)), setOpen(true))} data-testid="new-year">
        <CalendarPlus className="size-4" />
        {t("newYear")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("newYear")}</DialogTitle>
            <DialogDescription>{t("newYearBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("fieldNameEn")} htmlFor="yr-en">
                <Input id="yr-en" dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} data-testid="year-name" />
              </Field>
              <Field label={t("fieldNameAr")} htmlFor="yr-ar">
                <Input id="yr-ar" dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
              </Field>
              <Field label={t("fieldStartDate")} htmlFor="yr-start">
                <Input id="yr-start" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
              </Field>
              <Field label={t("fieldEndDate")} htmlFor="yr-end">
                <Input id="yr-end" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("terms")}</div>
              {f.terms.map((term, i) => (
                <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Input dir="ltr" value={term.nameEn} onChange={(e) => setTerm(i, { nameEn: e.target.value })} aria-label={t("fieldNameEn")} />
                  <Input dir="rtl" value={term.nameAr} onChange={(e) => setTerm(i, { nameAr: e.target.value })} aria-label={t("fieldNameAr")} />
                  <Button variant="ghost" size="icon-sm" onClick={() => setF((p) => ({ ...p, terms: p.terms.filter((_, j) => j !== i) }))} disabled={f.terms.length <= 1} aria-label={t("removeTerm")}>
                    <Trash2 className="size-3.5" />
                  </Button>
                  <Input type="date" value={term.startsOn} onChange={(e) => setTerm(i, { startsOn: e.target.value })} aria-label={t("fieldStartDate")} />
                  <Input type="date" value={term.endsOn} onChange={(e) => setTerm(i, { endsOn: e.target.value })} aria-label={t("fieldEndDate")} />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setF((p) => ({ ...p, terms: [...p.terms, { nameEn: "", nameAr: "", startsOn: p.endsOn, endsOn: p.endsOn }] }))} disabled={f.terms.length >= 4}>
                <Plus className="size-3.5" />
                {t("addTerm")}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={makeCurrent} onCheckedChange={setMakeCurrent} />
              {t("makeCurrent")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !f.nameEn.trim()} data-testid="year-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SetCurrentYearButton({ id }: { id: string }) {
  const t = useTranslations("calendarAdmin");
  const err = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setCurrentYearAction(id);
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("currentSet"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Star className="size-3.5" />}
      {t("makeCurrent")}
    </Button>
  );
}
