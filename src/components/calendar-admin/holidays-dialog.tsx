"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Moon, Sparkles } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import { addHolidaysAction } from "@/server/calendar/admin-actions";
import { useActionError } from "./shared";

export type Proposal = { key: string; titleEn: string; titleAr: string; startKey: string; days: number; estimated: boolean; exists: boolean };

export function HolidaysDialog({ proposals, yearName }: { proposals: Proposal[]; yearName: string }) {
  const t = useTranslations("calendarAdmin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const err = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(proposals.map((p) => ({ ...p, on: !p.exists })));
  const [publish, setPublish] = useState(true);
  const [pending, start] = useTransition();
  const chosen = rows.filter((r) => r.on);
  const update = (key: string, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () =>
    start(async () => {
      const res = await addHolidaysAction(chosen.map((r) => ({ titleEn: r.titleEn, titleAr: r.titleAr, startKey: r.startKey, days: r.days, estimated: r.estimated })), publish);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("holidaysAdded", { count: res.count ?? 0 }));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" onClick={() => (setRows(proposals.map((p) => ({ ...p, on: !p.exists }))), setOpen(true))} data-testid="uae-holidays">
        <Sparkles className="size-4" />
        {t("uaeHolidays")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("uaeHolidaysTitle", { year: yearName })}</DialogTitle>
            <DialogDescription>{t("uaeHolidaysBody")}</DialogDescription>
          </DialogHeader>
          <Alert>
            <Moon className="size-4" />
            <AlertDescription>{t("moonNote")}</AlertDescription>
          </Alert>
          <ul className="divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3 p-3" data-testid={`holiday-${r.key}`}>
                <Checkbox checked={r.on} onCheckedChange={(c) => update(r.key, { on: Boolean(c) })} aria-label={locale === "ar" ? r.titleAr : r.titleEn} />
                <div className="min-w-0 flex-1 basis-40">
                  <div className="text-sm font-medium">{locale === "ar" ? r.titleAr : r.titleEn}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {r.estimated ? <Pill tone="warning">{t("estimate")}</Pill> : <Pill tone="success">{t("fixedDate")}</Pill>}
                    {r.exists && <Pill tone="neutral">{t("alreadyOnCalendar")}</Pill>}
                  </div>
                </div>
                <Input type="date" value={r.startKey} onChange={(e) => e.target.value && update(r.key, { startKey: e.target.value })} className="w-40" aria-label={t("fieldStartDate")} />
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={10} value={r.days} onChange={(e) => update(r.key, { days: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className="w-16" aria-label={t("days")} />
                  <span className="text-xs text-muted-foreground">{t("days")}</span>
                </div>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch checked={publish} onCheckedChange={setPublish} />
            {publish ? t("publishedHint") : t("draftHint")}
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !chosen.length} data-testid="holidays-add">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("addHolidays", { count: chosen.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
