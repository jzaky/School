"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Check, Loader2, Pencil, Plus, UserMinus, UserPlus, X } from "lucide-react";
import type { CareerEventKind } from "@prisma/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, GradePicker } from "@/components/calendar-admin/shared";
import {
  cancelCareerEventAction,
  cancelEventRegistrationAction,
  markEventAttendanceAction,
  registerForEventAction,
  saveCareerEventAction,
  type CareerEventFormInput,
} from "@/server/career-events/actions";

export function useEventError() {
  const t = useTranslations("careerEvents");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

const KINDS: CareerEventKind[] = ["UNIVERSITY_VISIT", "FAIR", "INFO_SESSION"];

export type UniversityOption = { id: string; label: string };

export function EventDialog({ grades, universities, initial, defaults }: { grades: number[]; universities: UniversityOption[]; initial?: CareerEventFormInput; defaults: { date: string; deadline: string } }) {
  const t = useTranslations("careerEvents");
  const tc = useTranslations("common");
  const err = useEventError();
  const router = useRouter();
  const blank: CareerEventFormInput = {
    id: null,
    kind: "UNIVERSITY_VISIT",
    titleEn: "",
    titleAr: "",
    descEn: "",
    descAr: "",
    universityIds: [],
    otherUniversities: "",
    date: defaults.date,
    startTime: "10:00",
    endTime: "11:00",
    locationEn: "",
    locationAr: "",
    onlineUrl: "",
    gradeLevels: [],
    capacity: null,
    deadline: defaults.deadline,
  };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<CareerEventFormInput>(initial ?? blank);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof CareerEventFormInput>(k: K, v: CareerEventFormInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? universities.filter((u) => u.label.toLowerCase().includes(needle)) : universities;
    return list.slice(0, 80);
  }, [q, universities]);
  const valid = f.titleEn.trim().length > 2 && f.gradeLevels.length > 0 && (f.locationEn.trim().length > 0 || f.onlineUrl.trim().length > 0);
  const submit = () =>
    start(async () => {
      const res = await saveCareerEventAction(f);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      setOpen(false);
      if (!initial && res.id) router.push(`/career/events/${res.id}`);
      router.refresh();
    });
  return (
    <>
      {initial ? (
        <Button variant="outline" onClick={() => (setF(initial), setOpen(true))} data-testid="event-edit">
          <Pencil className="size-4" />
          {tc("edit")}
        </Button>
      ) : (
        <Button onClick={() => (setF(blank), setOpen(true))} data-testid="new-event">
          <Plus className="size-4" />
          {t("newEvent")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("editEvent") : t("newEvent")}</DialogTitle>
            <DialogDescription>{t("dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label={t("field.kind")}>
              <Select value={f.kind} onValueChange={(v) => set("kind", v as CareerEventKind)}>
                <SelectTrigger className="w-full sm:w-64" data-testid="event-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("field.titleEn")} htmlFor="ev-title-en">
                <Input id="ev-title-en" dir="ltr" value={f.titleEn} onChange={(e) => set("titleEn", e.target.value)} data-testid="event-title-en" />
              </Field>
              <Field label={t("field.titleAr")} htmlFor="ev-title-ar">
                <Input id="ev-title-ar" dir="rtl" value={f.titleAr} onChange={(e) => set("titleAr", e.target.value)} data-testid="event-title-ar" />
              </Field>
              <Field label={t("field.descEn")} htmlFor="ev-desc-en">
                <Textarea id="ev-desc-en" dir="ltr" rows={3} value={f.descEn} onChange={(e) => set("descEn", e.target.value)} />
              </Field>
              <Field label={t("field.descAr")} htmlFor="ev-desc-ar">
                <Textarea id="ev-desc-ar" dir="rtl" rows={3} value={f.descAr} onChange={(e) => set("descAr", e.target.value)} />
              </Field>
              <Field label={t("field.date")} htmlFor="ev-date">
                <Input id="ev-date" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} data-testid="event-date" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("field.start")} htmlFor="ev-st">
                  <Input id="ev-st" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
                </Field>
                <Field label={t("field.end")} htmlFor="ev-et">
                  <Input id="ev-et" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} />
                </Field>
              </div>
              <Field label={t("field.locationEn")} htmlFor="ev-loc-en">
                <Input id="ev-loc-en" dir="ltr" value={f.locationEn} onChange={(e) => set("locationEn", e.target.value)} data-testid="event-location" />
              </Field>
              <Field label={t("field.locationAr")} htmlFor="ev-loc-ar">
                <Input id="ev-loc-ar" dir="rtl" value={f.locationAr} onChange={(e) => set("locationAr", e.target.value)} />
              </Field>
              <Field label={t("field.onlineUrl")} htmlFor="ev-url" hint={t("field.onlineUrlHint")}>
                <Input id="ev-url" dir="ltr" type="url" placeholder="https://" value={f.onlineUrl} onChange={(e) => set("onlineUrl", e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("field.capacity")} htmlFor="ev-cap" hint={t("field.capacityHint")}>
                  <Input id="ev-cap" type="number" min={1} value={f.capacity ?? ""} onChange={(e) => set("capacity", e.target.value === "" ? null : Number(e.target.value))} data-testid="event-capacity" />
                </Field>
                <Field label={t("field.deadline")} htmlFor="ev-deadline">
                  <Input id="ev-deadline" type="date" max={f.date} value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
                </Field>
              </div>
            </div>
            <Field label={t("field.grades")}>
              <GradePicker grades={grades} value={f.gradeLevels} onChange={(v) => set("gradeLevels", v)} testId="event-grades" />
            </Field>
            <Field label={t("field.universities")} hint={t("field.selected", { count: f.universityIds.length })}>
              <Input placeholder={t("field.universitiesSearch")} value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" data-testid="event-uni-search" />
              <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {shown.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md p-1 text-sm hover:bg-muted/50">
                    <Checkbox checked={f.universityIds.includes(u.id)} onCheckedChange={(v) => set("universityIds", v ? [...f.universityIds, u.id] : f.universityIds.filter((x) => x !== u.id))} />
                    <span className="truncate">{u.label}</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label={t("field.otherUniversities")} htmlFor="ev-other" hint={t("field.otherUniversitiesHint")}>
              <Input id="ev-other" value={f.otherUniversities} onChange={(e) => set("otherUniversities", e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !valid} data-testid="event-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Register or cancel for one student. Shows why when registration is not possible. */
export function RegisterButton({ eventId, studentId, registered, canRegister, blockedReason }: { eventId: string; studentId: string; registered: boolean; canRegister: boolean; blockedReason?: string | null }) {
  const t = useTranslations("careerEvents");
  const err = useEventError();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (registered) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !canRegister}
        title={!canRegister ? (blockedReason ?? undefined) : undefined}
        onClick={() =>
          start(async () => {
            const res = await cancelEventRegistrationAction(eventId, studentId);
            if (!res.ok) return void toast.error(err(res.error));
            toast.success(t("cancelledToast"));
            router.refresh();
          })
        }
        data-testid="event-unregister"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
        {t("cancelRegistration")}
      </Button>
    );
  }
  if (!canRegister) {
    return blockedReason ? <span className="text-xs text-muted-foreground">{blockedReason}</span> : null;
  }
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await registerForEventAction(eventId, studentId);
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("registeredToast"));
          router.refresh();
        })
      }
      data-testid="event-register"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      {t("register")}
    </Button>
  );
}

export function AttendanceButtons({ eventId, studentId, attended }: { eventId: string; studentId: string; attended: boolean | null }) {
  const t = useTranslations("careerEvents");
  const err = useEventError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const mark = (v: boolean) =>
    start(async () => {
      const res = await markEventAttendanceAction(eventId, studentId, v);
      if (!res.ok) return void toast.error(err(res.error));
      router.refresh();
    });
  return (
    <div className="flex gap-1">
      <Button size="icon-sm" variant={attended === true ? "default" : "outline"} disabled={pending} onClick={() => mark(true)} aria-label={t("markAttended")} title={t("markAttended")} data-testid="mark-attended">
        <Check className="size-4" />
      </Button>
      <Button size="icon-sm" variant={attended === false ? "destructive" : "outline"} disabled={pending} onClick={() => mark(false)} aria-label={t("markAbsent")} title={t("markAbsent")} data-testid="mark-absent">
        <X className="size-4" />
      </Button>
    </div>
  );
}

export function CancelEventButton({ eventId }: { eventId: string }) {
  const t = useTranslations("careerEvents");
  const tc = useTranslations("common");
  const err = useEventError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="event-cancel">
        <Ban className="size-4" />
        {t("cancelEvent")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelEventTitle")}</DialogTitle>
            <DialogDescription>{t("cancelEventBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("back")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await cancelCareerEventAction(eventId);
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("eventCancelled"));
                  setOpen(false);
                  router.refresh();
                })
              }
              data-testid="event-cancel-confirm"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("cancelEvent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
