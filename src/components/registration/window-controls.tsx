"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, CalendarPlus, Loader2, Lock, Pencil, Save } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { gradeLevelValues } from "@/lib/grade-levels";
import { dubaiParts } from "@/lib/selection-window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { closeWindowAction, remindUnfinishedAction, saveSelectionSettingsAction, saveWindowAction } from "@/server/registration/selection-actions";
import { useSelError } from "./assist-controls";

export type YearOption = { id: string; label: string; next: boolean };
export type WindowValue = { id: string; yearId: string; gradeLevels: number[]; opensAt: string; closesAt: string; roundEn: string | null; roundAr: string | null };

/** Create or edit a selection window: year, grades, opening and closing date and time (Dubai), round name. */
export function WindowDialog({ years, grades, value, trigger = "new" }: { years: YearOption[]; grades: number[]; value?: WindowValue; trigger?: "new" | "edit" }) {
  const t = useTranslations("selection.windows");
  const tg = useTranslations("gradeLevel");
  const err = useSelError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const now = new Date();
  const opens = value ? dubaiParts(new Date(value.opensAt)) : { date: dubaiParts(now).date, time: "08:00" };
  const closes = value ? dubaiParts(new Date(value.closesAt)) : { date: dubaiParts(new Date(now.getTime() + 14 * 86_400_000)).date, time: "15:00" };
  const [yearId, setYearId] = useState(value?.yearId ?? years.find((y) => y.next)?.id ?? years[0]?.id ?? "");
  const [picked, setPicked] = useState<number[]>(value?.gradeLevels ?? []);
  const [opensDate, setOpensDate] = useState(opens.date);
  const [opensTime, setOpensTime] = useState(opens.time);
  const [closesDate, setClosesDate] = useState(closes.date);
  const [closesTime, setClosesTime] = useState(closes.time);
  const [roundEn, setRoundEn] = useState(value?.roundEn ?? "");
  const [roundAr, setRoundAr] = useState(value?.roundAr ?? "");
  const year = years.find((y) => y.id === yearId);
  const toggle = (g: number) => setPicked((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g].sort((a, b) => a - b)));
  const valid = !!yearId && picked.length > 0 && !!opensDate && !!closesDate && `${opensDate}T${opensTime}` < `${closesDate}T${closesTime}`;

  const save = () =>
    start(async () => {
      const res = await saveWindowAction({ id: value?.id ?? null, yearId, gradeLevels: picked, opensDate, opensTime, closesDate, closesTime, roundEn: roundEn || null, roundAr: roundAr || null });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {trigger === "new" ? (
        <Button onClick={() => setOpen(true)} data-testid="window-new">
          <CalendarPlus className="size-4" />
          {t("new")}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="window-edit">
          <Pencil className="size-4" />
          {t("edit")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{value ? t("editTitle") : t("newTitle")}</DialogTitle>
            <DialogDescription>{t("dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("yearLabel")}</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("yearLabel")}>
              {years.map((y) => (
                <button
                  key={y.id}
                  type="button"
                  role="radio"
                  aria-checked={yearId === y.id}
                  onClick={() => setYearId(y.id)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium", yearId === y.id ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}
                  data-testid={`window-year-${y.next ? "next" : "current"}`}
                >
                  {y.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("gradesLabel")}</Label>
            <div className="flex flex-wrap gap-1.5" data-testid="window-grades">
              {grades.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={picked.includes(g)}
                  onClick={() => toggle(g)}
                  className={cn("min-w-11 rounded-lg border px-2.5 py-1.5 text-xs font-medium", picked.includes(g) ? "border-brand bg-brand text-white" : "bg-card text-muted-foreground hover:text-foreground")}
                  data-testid={`window-grade-${g}`}
                >
                  {tg("label", gradeLevelValues(g))}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{year?.next ? t("gradesHintNext") : t("gradesHint")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="window-opens">{t("opensLabel")}</Label>
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
                <Input id="window-opens" type="date" value={opensDate} onChange={(e) => setOpensDate(e.target.value)} dir="ltr" data-testid="window-opens-date" />
                <Input type="time" value={opensTime} onChange={(e) => setOpensTime(e.target.value)} dir="ltr" step={300} aria-label={t("opensTime")} data-testid="window-opens-time" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="window-closes">{t("closesLabel")}</Label>
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
                <Input id="window-closes" type="date" value={closesDate} onChange={(e) => setClosesDate(e.target.value)} dir="ltr" data-testid="window-closes-date" />
                <Input type="time" value={closesTime} onChange={(e) => setClosesTime(e.target.value)} dir="ltr" step={300} aria-label={t("closesTime")} data-testid="window-closes-time" />
              </div>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t("dubaiHint")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="window-round-en">{t("roundEn")}</Label>
              <Input id="window-round-en" value={roundEn} onChange={(e) => setRoundEn(e.target.value)} maxLength={60} placeholder={t("roundEnPlaceholder")} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="window-round-ar">{t("roundAr")}</Label>
              <Input id="window-round-ar" value={roundAr} onChange={(e) => setRoundAr(e.target.value)} maxLength={60} placeholder={t("roundArPlaceholder")} dir="rtl" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending || !valid} data-testid="window-save">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CloseWindowButton({ id }: { id: string }) {
  const t = useTranslations("selection.windows");
  const err = useSelError();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirm(true)} data-testid="window-close">
        <Lock className="size-4" />
        {t("closeNow")}
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("closeTitle")}</DialogTitle>
            <DialogDescription>{t("closeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await closeWindowAction({ id });
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("closed"));
                  setConfirm(false);
                  router.refresh();
                })
              }
              data-testid="window-close-confirm"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("closeNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Remind those not finished": students and their parents, at most once a day each. */
export function RemindButton({ windowId, count, studentIds }: { windowId: string; count: number; studentIds?: string[] }) {
  const t = useTranslations("selection.overview");
  const err = useSelError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || count === 0}
      onClick={() =>
        start(async () => {
          const res = await remindUnfinishedAction({ windowId, studentIds });
          if (!res.ok) return void toast.error(err(res.error));
          if ("students" in res) toast.success(res.students ? t("reminded", { students: res.students, people: res.people }) : t("remindedAlready"));
          router.refresh();
        })
      }
      data-testid="remind-unfinished"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
      {t("remind", { count })}
    </Button>
  );
}

type Settings = { parentChoice: "ALWAYS" | "WHEN_ALLOWED" | "NEVER"; signOffRequired: boolean; parentChoiceSignsOff: boolean };

/** The school's rules: whether parents can choose, and parent sign-off. */
export function SelectionSettingsForm({ value }: { value: Settings }) {
  const t = useTranslations("selection.settings");
  const err = useSelError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, setS] = useState<Settings>(value);
  const dirty = s.parentChoice !== value.parentChoice || s.signOffRequired !== value.signOffRequired || s.parentChoiceSignsOff !== value.parentChoiceSignsOff;
  return (
    <div className="space-y-4" data-testid="selection-settings">
      <div className="space-y-2">
        <div className="text-sm font-medium">{t("parentChoice")}</div>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("parentChoice")}>
          {(["ALWAYS", "WHEN_ALLOWED", "NEVER"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={s.parentChoice === m}
              onClick={() => setS({ ...s, parentChoice: m })}
              className={cn("rounded-lg border p-3 text-start transition-colors", s.parentChoice === m ? "border-brand bg-brand-soft/60 ring-1 ring-brand/30" : "hover:bg-muted/40")}
              data-testid={`parent-choice-${m}`}
            >
              <span className="block text-sm font-medium">{t(`mode.${m}.label`)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(`mode.${m}.help`)}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <span>
          <span className="block text-sm font-medium">{t("signOff")}</span>
          <span className="block text-xs text-muted-foreground">{t("signOffHelp")}</span>
        </span>
        <Switch checked={s.signOffRequired} onCheckedChange={(v) => setS({ ...s, signOffRequired: v })} data-testid="sign-off-required" />
      </label>
      {s.signOffRequired && s.parentChoice !== "NEVER" && (
        <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-medium">{t("parentSigns")}</span>
            <span className="block text-xs text-muted-foreground">{t("parentSignsHelp")}</span>
          </span>
          <Switch checked={s.parentChoiceSignsOff} onCheckedChange={(v) => setS({ ...s, parentChoiceSignsOff: v })} />
        </label>
      )}
      <div className="flex justify-end">
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const res = await saveSelectionSettingsAction(s);
              if (!res.ok) return void toast.error(err(res.error));
              toast.success(t("saved"));
              router.refresh();
            })
          }
          data-testid="settings-save"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
