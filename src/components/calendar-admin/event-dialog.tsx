"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteEventAction, saveEventAction, setEventPublishedAction, type EventInput } from "@/server/calendar/admin-actions";
import { ChipPicker, Field, GradePicker, useActionError } from "./shared";

export type EventDraft = Omit<EventInput, "descEn" | "descAr" | "locationEn" | "locationAr" | "startTime" | "endTime"> & { descEn: string; descAr: string; locationEn: string; locationAr: string; startTime: string; endTime: string };

const KINDS = ["EVENT", "DEADLINE", "HOLIDAY", "EXAM"] as const;

export function EventDialog({ grades, initial, defaultDate }: { grades: number[]; initial?: EventDraft; defaultDate: string }) {
  const t = useTranslations("calendarAdmin");
  const tc = useTranslations("common");
  const err = useActionError();
  const router = useRouter();
  const blank: EventDraft = { id: null, kind: "EVENT", titleEn: "", titleAr: "", descEn: "", descAr: "", locationEn: "", locationAr: "", allDay: true, startDate: defaultDate, endDate: defaultDate, startTime: "09:00", endTime: "10:00", audience: ["staff", "student", "parent"], gradeLevels: [], published: true };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<EventDraft>(initial ?? blank);
  const [pending, start] = useTransition();
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.titleEn.trim().length > 1 && f.startDate && f.endDate >= f.startDate && f.audience.length > 0;

  const submit = () =>
    start(async () => {
      const res = await saveEventAction(f);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("eventSaved"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon-sm" onClick={() => (setF(initial), setOpen(true))} aria-label={tc("edit")} data-testid="event-edit">
          <Pencil className="size-3.5" />
        </Button>
      ) : (
        <Button onClick={() => (setF(blank), setOpen(true))} data-testid="add-event">
          <Plus className="size-4" />
          {t("addEvent")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("editEvent") : t("addEvent")}</DialogTitle>
            <DialogDescription>{t("eventDialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label={t("fieldKind")}>
              <Select value={f.kind} onValueChange={(v) => set("kind", v as EventDraft["kind"])}>
                <SelectTrigger className="w-full" data-testid="event-kind">
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
              <Field label={t("fieldTitleEn")} htmlFor="ev-title-en">
                <Input id="ev-title-en" dir="ltr" value={f.titleEn} onChange={(e) => set("titleEn", e.target.value)} data-testid="event-title-en" />
              </Field>
              <Field label={t("fieldTitleAr")} htmlFor="ev-title-ar">
                <Input id="ev-title-ar" dir="rtl" value={f.titleAr} onChange={(e) => set("titleAr", e.target.value)} data-testid="event-title-ar" />
              </Field>
              <Field label={t("fieldDescEn")} htmlFor="ev-desc-en">
                <Textarea id="ev-desc-en" dir="ltr" rows={2} value={f.descEn} onChange={(e) => set("descEn", e.target.value)} />
              </Field>
              <Field label={t("fieldDescAr")} htmlFor="ev-desc-ar">
                <Textarea id="ev-desc-ar" dir="rtl" rows={2} value={f.descAr} onChange={(e) => set("descAr", e.target.value)} />
              </Field>
              <Field label={t("fieldLocationEn")} htmlFor="ev-loc-en">
                <Input id="ev-loc-en" dir="ltr" value={f.locationEn} onChange={(e) => set("locationEn", e.target.value)} />
              </Field>
              <Field label={t("fieldLocationAr")} htmlFor="ev-loc-ar">
                <Input id="ev-loc-ar" dir="rtl" value={f.locationAr} onChange={(e) => set("locationAr", e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={f.allDay} onCheckedChange={(v) => set("allDay", v)} data-testid="event-allday" />
              {t("fieldAllDay")}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("fieldStartDate")} htmlFor="ev-start">
                <Input id="ev-start" type="date" value={f.startDate} onChange={(e) => setF((p) => ({ ...p, startDate: e.target.value, endDate: p.endDate < e.target.value ? e.target.value : p.endDate }))} data-testid="event-start" />
              </Field>
              <Field label={t("fieldEndDate")} htmlFor="ev-end">
                <Input id="ev-end" type="date" min={f.startDate} value={f.endDate} onChange={(e) => set("endDate", e.target.value)} data-testid="event-end" />
              </Field>
              {!f.allDay && (
                <>
                  <Field label={t("fieldStartTime")} htmlFor="ev-st">
                    <Input id="ev-st" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
                  </Field>
                  <Field label={t("fieldEndTime")} htmlFor="ev-et">
                    <Input id="ev-et" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} />
                  </Field>
                </>
              )}
            </div>
            <Field label={t("fieldAudience")}>
              <ChipPicker options={(["staff", "student", "parent"] as const).map((a) => ({ value: a, label: t(`audience.${a}`) }))} value={f.audience} onChange={(v) => set("audience", v)} />
            </Field>
            <Field label={t("fieldGrades")} hint={t("fieldGradesHint")}>
              <GradePicker grades={grades} value={f.gradeLevels} onChange={(v) => set("gradeLevels", v)} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={f.published} onCheckedChange={(v) => set("published", v)} data-testid="event-published" />
              {f.published ? t("publishedHint") : t("draftHint")}
            </label>
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

export function EventPublishSwitch({ id, published }: { id: string; published: boolean }) {
  const t = useTranslations("calendarAdmin");
  const err = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={published}
      disabled={pending}
      aria-label={published ? t("unpublish") : t("publish")}
      onCheckedChange={(v) =>
        start(async () => {
          const res = await setEventPublishedAction(id, v);
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(v ? t("eventPublished") : t("eventUnpublished"));
          router.refresh();
        })
      }
      data-testid="event-publish-toggle"
    />
  );
}

export function EventDeleteButton({ id, title }: { id: string; title: string }) {
  const t = useTranslations("calendarAdmin");
  const tc = useTranslations("common");
  const err = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label={tc("delete")} data-testid="event-delete">
        <Trash2 className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteEventTitle")}</DialogTitle>
            <DialogDescription>{t("deleteEventBody", { title })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteEventAction(id);
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("eventDeleted"));
                  setOpen(false);
                  router.refresh();
                })
              }
              data-testid="event-delete-confirm"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
