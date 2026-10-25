"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarX, Loader2, Lock, UserRoundCog, Users, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import { cancelAbsenceAction, declineCoverAction, freeSubstitutesAction, reassignCoverAction, reportAbsenceAction, type SubOption } from "@/server/timetable/actions";

function useErr() {
  const t = useTranslations("timetable");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export function DeclineCoverButton({ coverId, label }: { coverId: string; label: string }) {
  const t = useTranslations("timetable");
  const err = useErr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await declineCoverAction({ coverId, reason });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(r.reassigned ? t("declinedReassigned") : t("declinedNoOne"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setOpen(true)} data-testid="decline-cover">
        {t("decline")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("declineTitle")}</DialogTitle>
            <DialogDescription>{t("declineBody", { cls: label })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decline-reason">{t("declineReason")}</Label>
            <Textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="decline-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !reason.trim()} data-testid="confirm-decline">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("decline")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type TeacherOption = { id: string; name: string };
const REASONS = ["SICK", "MEDICAL_APPOINTMENT", "ANNUAL_LEAVE", "FAMILY", "PARENTAL_LEAVE", "RELIGIOUS", "TRAINING", "SCHOOL_BUSINESS", "PERSONAL", "OTHER"] as const;
export type PeriodOption = { periodNo: number; label: string };

/** Report an absence. Without `teachers` it is for yourself; with them a cover manager picks the teacher. */
export function ReportAbsenceDialog({ teachers, periods, today, triggerLabel }: { teachers?: TeacherOption[]; periods: PeriodOption[]; today: string; triggerLabel?: string }) {
  const t = useTranslations("timetable");
  const err = useErr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string>("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [p1, setP1] = useState<string>(String(periods[0]?.periodNo ?? 1));
  const [p2, setP2] = useState<string>(String(periods[periods.length - 1]?.periodNo ?? 1));
  const [notes, setNotes] = useState("");
  const [reasonKind, setReasonKind] = useState<string>("");
  const [privateReason, setPrivateReason] = useState("");
  const [pending, start] = useTransition();
  const needWho = Boolean(teachers);
  const valid = (!needWho || who) && from && to && to >= from && (allDay || Number(p2) >= Number(p1));

  const submit = () =>
    start(async () => {
      const r = await reportAbsenceAction({
        membershipId: needWho ? who : null,
        startsOn: from,
        endsOn: to,
        allDay,
        fromPeriod: allDay ? null : Number(p1),
        toPeriod: allDay ? null : Number(p2),
        notes: notes.trim() || null,
        reasonKind: (reasonKind || null) as never,
        privateReason: privateReason.trim() || null,
      });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(r.created === 0 ? t("absenceNoLessons") : t("absenceSaved", { covered: r.covered, total: r.created }));
      setOpen(false);
      setNotes("");
      setReasonKind("");
      setPrivateReason("");
      router.refresh();
    });

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="report-absence">
        <CalendarX className="size-4" />
        {triggerLabel ?? t("reportAbsence")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{needWho ? t("markAbsentTitle") : t("reportAbsenceTitle")}</DialogTitle>
            <DialogDescription>{t("reportAbsenceBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {needWho && (
              <div className="space-y-1.5">
                <Label>{t("teacher")}</Label>
                <Select value={who} onValueChange={setWho}>
                  <SelectTrigger className="w-full" data-testid="absence-teacher">
                    <SelectValue placeholder={t("chooseTeacher")} />
                  </SelectTrigger>
                  <SelectContent>
                    {teachers!.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="abs-from">{t("from")}</Label>
                <Input id="abs-from" type="date" value={from} onChange={(e) => (setFrom(e.target.value), e.target.value > to && setTo(e.target.value))} data-testid="absence-from" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="abs-to">{t("to")}</Label>
                <Input id="abs-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} data-testid="absence-to" />
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="text-sm">{t("wholeDay")}</span>
              <Switch checked={allDay} onCheckedChange={setAllDay} data-testid="absence-allday" />
            </label>
            {!allDay && (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { v: p1, set: setP1, label: t("fromLesson") },
                  { v: p2, set: setP2, label: t("toLesson") },
                ].map((f) => (
                  <div key={f.label} className="space-y-1.5">
                    <Label>{f.label}</Label>
                    <Select value={f.v} onValueChange={f.set}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {periods.map((p) => (
                          <SelectItem key={p.periodNo} value={String(p.periodNo)}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
            <fieldset className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3" data-testid="private-reason">
              <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-violet-800">
                <Lock className="size-3.5" />
                {t("privateReason")}
              </legend>
              <Select value={reasonKind} onValueChange={setReasonKind}>
                <SelectTrigger className="w-full bg-card" data-testid="absence-reason-kind">
                  <SelectValue placeholder={t("chooseReason")} />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`reasonKind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea value={privateReason} onChange={(e) => setPrivateReason(e.target.value)} maxLength={500} rows={2} placeholder={t("privateReasonPlaceholder")} aria-label={t("privateReasonDetails")} className="bg-card" data-testid="absence-private-details" />
              <p className="text-xs text-violet-800/80">{needWho ? t("privateReasonHelpManager") : t("privateReasonHelp")}</p>
            </fieldset>
            <fieldset className="space-y-1.5 rounded-lg border border-info/25 bg-info-soft/40 p-3">
              <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-info">
                <Users className="size-3.5" />
                {t("notesForCover")}
              </legend>
              <Textarea id="abs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder={t("notesPlaceholder")} aria-label={t("notesForCover")} className="bg-card" data-testid="absence-notes" />
              <p className="text-xs text-muted-foreground">{t("notesHelp")}</p>
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !valid} data-testid="confirm-absence">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("saveAndCover")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelAbsenceButton({ absenceId }: { absenceId: string }) {
  const t = useTranslations("timetable");
  const err = useErr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await cancelAbsenceAction(absenceId);
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(t("absenceCancelled"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="cancel-absence">
        <X className="size-4" />
        {t("cancelAbsence")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelAbsenceTitle")}</DialogTitle>
            <DialogDescription>{t("cancelAbsenceBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("keep")}
            </Button>
            <Button variant="destructive" onClick={submit} disabled={pending} data-testid="confirm-cancel-absence">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("cancelAbsence")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const TIER_TONE = { DEPARTMENT: "success", QUALIFIED: "info", ANY: "neutral" } as const;

/** Reassign one cover: pick from the free staff (best first) or let the system choose. */
export function ReassignCoverButton({ coverId, label }: { coverId: string; label: string }) {
  const t = useTranslations("timetable");
  const err = useErr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SubOption[] | null>(null);
  const [pending, start] = useTransition();

  const load = () => {
    setOpen(true);
    setOptions(null);
    freeSubstitutesAction(coverId).then((r) => (r.ok ? setOptions(r.options) : toast.error(err(r.error))));
  };
  const assign = (substituteId: string | null) =>
    start(async () => {
      const r = await reassignCoverAction({ coverId, substituteId });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(r.substituteId ? t("reassigned") : t("stillUncovered"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant="outline" onClick={load} data-testid="reassign-cover">
        <UserRoundCog className="size-4" />
        {t("reassign")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("reassignTitle")}</DialogTitle>
            <DialogDescription>{label}</DialogDescription>
          </DialogHeader>
          {!options ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("findingFree")}
            </div>
          ) : options.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("nobodyFree")}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {options.map((o, i) => (
                <li key={o.id} className="flex items-center justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{o.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Pill tone={TIER_TONE[o.tier]}>{t(`tier.${o.tier}`)}</Pill>
                      <Pill>{t("coverThisWeek", { n: o.coverCount })}</Pill>
                      {o.overLimit && <Pill tone="warning">{t("overLimit")}</Pill>}
                      {i === 0 && <Pill tone="brand">{t("bestMatch")}</Pill>}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => assign(o.id)} disabled={pending} data-testid="pick-sub">
                    {t("assign")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
