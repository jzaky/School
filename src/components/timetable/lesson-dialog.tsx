"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { moveLessonAction, moveOptionsAction, toggleLockAction, type MoveOption } from "@/server/timetable/actions";
import type { GridLesson, GridPeriod } from "@/server/timetable/queries";
import { dayName } from "./day-name";

export function useTtError() {
  const t = useTranslations("timetable");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

/** Move a lesson to another period (clashes shown before you choose) and lock or unlock it. */
export function LessonDialog({ lesson, periods, onClose }: { lesson: GridLesson; periods: GridPeriod[]; onClose: () => void }) {
  const t = useTranslations("timetable");
  const locale = useLocale();
  const err = useTtError();
  const router = useRouter();
  const [options, setOptions] = useState<MoveOption[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    moveOptionsAction(lesson.slotId!).then((r) => {
      if (!live) return;
      if (r.ok) setOptions(r.options);
      else toast.error(err(r.error));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.slotId]);

  const days = [...new Set(periods.map((p) => p.day))];
  const lessonNo = (day: number, no: number) => periods.find((p) => p.day === day && p.periodNo === no)?.lessonNo ?? no;
  const chosen = options?.find((o) => `${o.day}|${o.period}` === target);

  const move = () =>
    chosen &&
    start(async () => {
      const r = await moveLessonAction({ slotId: lesson.slotId!, day: chosen.day, period: chosen.period });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(t("moved"));
      onClose();
      router.refresh();
    });
  const lock = () =>
    start(async () => {
      const r = await toggleLockAction({ slotId: lesson.slotId!, locked: !lesson.locked });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(lesson.locked ? t("unlockedToast") : t("lockedToast"));
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lesson.title}</DialogTitle>
          <DialogDescription>
            {dayName(locale, lesson.day)} · {t("lessonN", { n: lessonNo(lesson.day, lesson.periodNo) })}
            {lesson.subtitle ? ` · ${lesson.subtitle}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("moveTo")}</div>
          <p className="text-xs text-muted-foreground">{t("moveHelp")}</p>
          {!options ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("checkingClashes")}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((d) => (
                <div key={d} className="space-y-1">
                  <div className="text-center text-[11px] font-semibold">{dayName(locale, d, "short")}</div>
                  {options
                    .filter((o) => o.day === d)
                    .map((o) => {
                      const k = `${o.day}|${o.period}`;
                      const here = o.day === lesson.day && o.period === lesson.periodNo;
                      const clash = o.clashes.length > 0;
                      return (
                        <button
                          key={k}
                          type="button"
                          disabled={clash || here}
                          onClick={() => setTarget(k)}
                          title={clash ? o.clashes.map((c) => `${t(`clash.${c.kind}`)}: ${c.className}`).join("\n") : undefined}
                          className={cn(
                            "w-full rounded border px-1 py-1 text-[11px] tabular-nums",
                            here && "border-brand bg-brand-soft font-semibold",
                            !here && clash && "cursor-not-allowed border-danger/20 bg-danger-soft/50 text-danger/70 line-through",
                            !here && !clash && "border-success/30 bg-success-soft/60 hover:border-success",
                            target === k && "ring-2 ring-brand",
                          )}
                          data-testid={clash ? "move-clash" : here ? "move-here" : "move-free"}
                        >
                          {lessonNo(o.day, o.period)}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
          {chosen && (
            <p className="text-xs text-success">
              {t("moveChosen", { day: dayName(locale, chosen.day), n: lessonNo(chosen.day, chosen.period) })}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-success-soft ring-1 ring-success/40" />
              {t("legendFree")}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-danger-soft ring-1 ring-danger/30" />
              {t("legendClash")}
            </span>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={lock} disabled={pending} data-testid="toggle-lock">
            {lesson.locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
            {lesson.locked ? t("unlock") : t("lock")}
          </Button>
          <Button onClick={move} disabled={pending || !chosen} data-testid="confirm-move">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("moveLesson")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
