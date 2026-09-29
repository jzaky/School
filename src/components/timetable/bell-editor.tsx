"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Clock, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/app/empty-state";
import { applyBellPresetAction, saveBellDaysAction } from "@/server/timetable/actions";
import { UAE_PRESET, type PeriodKindT } from "@/server/timetable/bell";
import { useTtError } from "./lesson-dialog";

type Row = { day: number; periodNo: number; startTime: string; endTime: string; kind: PeriodKindT };
type Day = { day: number; name: string };

const KIND_STYLE: Record<PeriodKindT, string> = { LESSON: "bg-brand-soft/60 text-foreground", BREAK: "bg-muted text-muted-foreground", ASSEMBLY: "bg-gold-soft text-foreground" };

export function BellEditor({ days, periods, hasLessons }: { days: Day[]; periods: Row[]; hasLessons: boolean }) {
  const t = useTranslations("timetable");
  const [editing, setEditing] = useState<number | null>(null);
  const [preset, setPreset] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("bellHelp")}</p>
        <Button onClick={() => setPreset(true)} data-testid="bell-preset">
          <Sparkles className="size-4" />
          {t("presetButton")}
        </Button>
      </div>
      {periods.length === 0 ? (
        <EmptyState icon={<Clock className="size-5" />} title={t("noBell")} body={t("noBellBody")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {days.map((d) => {
            const rows = periods.filter((p) => p.day === d.day);
            let n = 0;
            return (
              <div key={d.day} className="rounded-xl border bg-card p-3 shadow-xs" data-testid="bell-day">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{d.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(d.day)} data-testid="edit-bell-day">
                    <Pencil className="size-4" />
                    <span className="sr-only">{t("edit")}</span>
                  </Button>
                </div>
                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("noSchool")}</p>
                ) : (
                  <ol className="space-y-1">
                    {rows.map((r) => (
                      <li key={r.periodNo} className={cn("flex items-center justify-between rounded-md px-2 py-1 text-xs", KIND_STYLE[r.kind])}>
                        <span className="font-medium">{r.kind === "LESSON" ? t("lessonN", { n: ++n }) : r.kind === "BREAK" ? t("break") : t("assembly")}</span>
                        <span className="tabular-nums" dir="ltr">
                          {r.startTime} - {r.endTime}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing !== null && <DayDialog day={editing} days={days} rows={periods.filter((p) => p.day === editing)} hasLessons={hasLessons} onClose={() => setEditing(null)} />}
      {preset && <PresetDialog hasBell={periods.length > 0} hasLessons={hasLessons} onClose={() => setPreset(false)} />}
    </div>
  );
}

function PresetDialog({ hasBell, hasLessons, onClose }: { hasBell: boolean; hasLessons: boolean; onClose: () => void }) {
  const t = useTranslations("timetable");
  const err = useTtError();
  const router = useRouter();
  const [v, setV] = useState({ start: UAE_PRESET.start, assemblyMin: UAE_PRESET.assemblyMin, lessonsPerDay: UAE_PRESET.lessonsPerDay, lessonMin: UAE_PRESET.lessonMin, fridayLessons: UAE_PRESET.fridayLessons, fridayLessonMin: UAE_PRESET.fridayLessonMin });
  const [pending, start] = useTransition();
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const apply = () =>
    start(async () => {
      const r = await applyBellPresetAction(v);
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(r.removedLessons ? t("bellSavedRemoved", { n: r.removedLessons }) : t("bellSaved"));
      onClose();
      router.refresh();
    });
  const fields: Array<{ k: keyof typeof v; label: string }> = [
    { k: "lessonsPerDay", label: t("presetLessons") },
    { k: "lessonMin", label: t("presetLessonMin") },
    { k: "assemblyMin", label: t("presetAssemblyMin") },
    { k: "fridayLessons", label: t("presetFridayLessons") },
    { k: "fridayLessonMin", label: t("presetFridayMin") },
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("presetTitle")}</DialogTitle>
          <DialogDescription>{t("presetBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="preset-start">{t("presetStart")}</Label>
            <Input id="preset-start" type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} dir="ltr" />
          </div>
          {fields.map((f) => (
            <div key={f.k} className="space-y-1.5">
              <Label htmlFor={`preset-${f.k}`}>{f.label}</Label>
              <Input id={`preset-${f.k}`} type="number" min={0} value={v[f.k] as number} onChange={num(f.k)} />
            </div>
          ))}
        </div>
        {hasBell && (
          <Alert>
            <AlertDescription>{hasLessons ? t("presetReplaceLessons") : t("presetReplace")}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={apply} disabled={pending} data-testid="apply-preset">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DayDialog({ day, days, rows, hasLessons, onClose }: { day: number; days: Day[]; rows: Row[]; hasLessons: boolean; onClose: () => void }) {
  const t = useTranslations("timetable");
  const err = useTtError();
  const router = useRouter();
  const [list, setList] = useState(rows.map((r) => ({ startTime: r.startTime, endTime: r.endTime, kind: r.kind })));
  const [targets, setTargets] = useState<number[]>([day]);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof list)[number]>) => setList(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    const last = list[list.length - 1];
    const s = last?.endTime ?? "07:30";
    const [h, m] = s.split(":").map(Number);
    const e = h * 60 + m + 45;
    setList([...list, { startTime: s, endTime: `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`, kind: "LESSON" }]);
  };
  const save = () =>
    start(async () => {
      const r = await saveBellDaysAction({ days: targets, rows: list });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(r.removedLessons ? t("bellSavedRemoved", { n: r.removedLessons }) : t("bellSaved"));
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("editDay", { day: days.find((d) => d.day === day)?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("editDayBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {list.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1.3fr_auto] items-center gap-2">
              <Input type="time" value={r.startTime} onChange={(e) => set(i, { startTime: e.target.value })} dir="ltr" aria-label={t("startTime")} />
              <Input type="time" value={r.endTime} onChange={(e) => set(i, { endTime: e.target.value })} dir="ltr" aria-label={t("endTime")} />
              <Select value={r.kind} onValueChange={(k) => set(i, { kind: k as PeriodKindT })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LESSON">{t("kindLESSON")}</SelectItem>
                  <SelectItem value="BREAK">{t("break")}</SelectItem>
                  <SelectItem value="ASSEMBLY">{t("assembly")}</SelectItem>
                </SelectContent>
              </Select>
              <Button size="icon" variant="ghost" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label={t("remove")}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-4" />
            {t("addPeriod")}
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label>{t("applyToDays")}</Label>
          <div className="flex flex-wrap gap-3">
            {days.map((d) => (
              <label key={d.day} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={targets.includes(d.day)} onCheckedChange={(c) => setTargets(c ? [...targets, d.day] : targets.filter((x) => x !== d.day))} />
                {d.name}
              </label>
            ))}
          </div>
        </div>
        {hasLessons && (
          <Alert>
            <AlertDescription>{t("editDayWarning")}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending || targets.length === 0} data-testid="save-bell-day">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
