"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Loader2, Lock, Pencil, Plus, Shuffle, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteOfferingAction, moveStudentAction, runAllocationAction, saveOfferingAction, setWindowAction } from "@/server/registration/actions";

export function useRegError() {
  const t = useTranslations("registration");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

/** Open the registration window until a date (15:00 Dubai time), or close it now. */
export function WindowControl({ open, deadlineDate }: { open: boolean; deadlineDate: string | null }) {
  const t = useTranslations("registration");
  const err = useRegError();
  const router = useRouter();
  const [dialog, setDialog] = useState(false);
  const [date, setDate] = useState(deadlineDate ?? "");
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const save = (deadline: string | null) =>
    start(async () => {
      const res = await setWindowAction({ deadline });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(deadline ? t("windowOpened") : t("windowClosed"));
      setDialog(false);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" onClick={() => setDialog(true)} data-testid="window-control">
        <CalendarClock className="size-4" />
        {open ? t("changeDeadline") : t("openWindow")}
      </Button>
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("windowTitle")}</DialogTitle>
            <DialogDescription>{t("windowBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reg-deadline">{t("deadlineLabel")}</Label>
            <Input id="reg-deadline" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" data-testid="window-deadline" />
            <p className="text-xs text-muted-foreground">{t("deadlineHint")}</p>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {open ? (
              <Button variant="outline" onClick={() => save(null)} disabled={pending} data-testid="window-close">
                <Lock className="size-4" />
                {t("closeNow")}
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={() => save(`${date}T15:00:00+04:00`)} disabled={pending || !date || date < today} data-testid="window-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {open ? t("saveDeadline") : t("openWindow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RunAllocationButton() {
  const t = useTranslations("registration");
  const err = useRegError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const res = await runAllocationAction();
          if (!res.ok) return void toast.error(err(res.error));
          const s = res.summary;
          toast.success(s.placed + s.moved + s.removed + s.sectionsCreated === 0 ? t("allocationNoChange") : t("allocationDone", { placed: s.placed, sections: s.sectionsCreated, removed: s.removed }));
          router.refresh();
        })
      }
      disabled={pending}
      data-testid="run-allocation"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Shuffle className="size-4" />}
      {t("runAllocation")}
    </Button>
  );
}

export type SubjectOption = { id: string; code: string; label: string };
export type OfferingValue = { id?: string; subjectId: string; kind: "CORE" | "OPTION"; optionBlock: string | null; prerequisites: string[]; periodsPerWeek: number };

const BLOCKS = ["A", "B", "C", "D", "E", "F"];

export function OfferingDialog({ grade, subjects, value, takenSubjectIds }: { grade: number; subjects: SubjectOption[]; value?: OfferingValue; takenSubjectIds: string[] }) {
  const t = useTranslations("registration");
  const err = useRegError();
  const router = useRouter();
  const editing = Boolean(value?.id);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const available = editing ? subjects : subjects.filter((s) => !takenSubjectIds.includes(s.id));
  const [subjectId, setSubjectId] = useState(value?.subjectId ?? "");
  const [kind, setKind] = useState<"CORE" | "OPTION">(value?.kind ?? "OPTION");
  const [block, setBlock] = useState(value?.optionBlock ?? "A");
  const [prereq, setPrereq] = useState<string[]>(value?.prerequisites ?? []);
  const [periods, setPeriods] = useState(String(value?.periodsPerWeek ?? 4));
  const code = subjects.find((s) => s.id === subjectId)?.code;
  const periodsNum = Number(periods);
  const valid = subjectId && Number.isInteger(periodsNum) && periodsNum >= 1 && periodsNum <= 12;

  const submit = () =>
    start(async () => {
      const res = await saveOfferingAction({ id: value?.id, gradeLevel: grade, subjectId, kind, optionBlock: kind === "OPTION" ? block : null, prerequisites: prereq, periodsPerWeek: periodsNum });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("offeringSaved"));
      setOpen(false);
      router.refresh();
    });

  if (!editing && available.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button size="sm" disabled>
              <Plus className="size-4" />
              {t("addOffering")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("allSubjectsOffered")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      {editing ? (
        <Button size="icon" variant="ghost" className="size-8" onClick={() => setOpen(true)} aria-label={t("editOffering")} data-testid="edit-offering">
          <Pencil className="size-3.5" />
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)} data-testid="add-offering">
          <Plus className="size-4" />
          {t("addOffering")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("editOffering") : t("addOfferingTitle", { grade })}</DialogTitle>
            <DialogDescription>{t("offeringBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("fieldSubject")}</Label>
              <Select value={subjectId} onValueChange={setSubjectId} disabled={editing}>
                <SelectTrigger className="w-full" data-testid="offering-subject">
                  <SelectValue placeholder={t("chooseSubject")} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("fieldKind")}</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as "CORE" | "OPTION")}>
                  <SelectTrigger className="w-full" data-testid="offering-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CORE">{t("kindCore")}</SelectItem>
                    <SelectItem value="OPTION">{t("kindOption")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {kind === "OPTION" && (
                <div className="space-y-1.5">
                  <Label>{t("fieldBlock")}</Label>
                  <Select value={block} onValueChange={setBlock}>
                    <SelectTrigger className="w-full" data-testid="offering-block">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BLOCKS.map((b) => (
                        <SelectItem key={b} value={b}>
                          {t("blockN", { block: b })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="offering-periods">{t("fieldPeriods")}</Label>
                <Input id="offering-periods" type="number" min={1} max={12} value={periods} onChange={(e) => setPeriods(e.target.value)} dir="ltr" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldPrereq")}</Label>
              <p className="text-xs text-muted-foreground">{t("prereqHint")}</p>
              <div className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2">
                {subjects
                  .filter((s) => s.code !== code)
                  .map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md p-1 text-sm hover:bg-muted/50">
                      <Checkbox checked={prereq.includes(s.code)} onCheckedChange={(c) => setPrereq(c ? [...prereq, s.code] : prereq.filter((x) => x !== s.code))} />
                      <span className="truncate">{s.label}</span>
                    </label>
                  ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !valid} data-testid="offering-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteOfferingButton({ id, inUse }: { id: string; inUse: boolean }) {
  const t = useTranslations("registration");
  const err = useRegError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const button = (
    <Button
      size="icon"
      variant="ghost"
      className="size-8 text-muted-foreground hover:text-danger"
      aria-label={t("removeOffering")}
      disabled={pending || inUse}
      onClick={() =>
        start(async () => {
          const res = await deleteOfferingAction({ id });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("offeringRemoved"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </Button>
  );
  if (!inUse) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{t("error.IN_USE")}</TooltipContent>
    </Tooltip>
  );
}

/** Move a student to another section of the same subject. Only rendered when another section exists. */
export function MoveStudent({ registrationId, currentClassId, sections, studentName }: { registrationId: string; currentClassId: string; sections: Array<{ id: string; label: string; full: boolean }>; studentName: string }) {
  const t = useTranslations("registration");
  const err = useRegError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value=""
      disabled={pending}
      onValueChange={(classId) =>
        start(async () => {
          const res = await moveStudentAction({ registrationId, classId });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("moved", { name: studentName }));
          router.refresh();
        })
      }
    >
      <SelectTrigger className="h-8 w-full text-xs sm:w-36" aria-label={t("moveTo")} data-testid="move-student">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <SelectValue placeholder={t("moveTo")} />}
      </SelectTrigger>
      <SelectContent>
        {sections
          .filter((s) => s.id !== currentClassId)
          .map((s) => (
            <SelectItem key={s.id} value={s.id} disabled={s.full}>
              {s.full ? t("sectionFull", { name: s.label }) : s.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
