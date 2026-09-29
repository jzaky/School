"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Bell, CheckCircle2, Download, Loader2, Pencil, Plus, Send, Trash2, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Field, GradePicker } from "@/components/calendar-admin/shared";
import { cancelTripAction, completeTripAction, consentAction, deleteDraftTripAction, publishTripAction, remindTripAction, saveTripAction, type TripInput } from "@/server/trips/actions";

export function useTripError() {
  const t = useTranslations("trips");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export type ClassOption = { value: string; label: string; grade: number };

export function TripDialog({ grades, classes, initial, defaults }: { grades: number[]; classes: ClassOption[]; initial?: TripInput; defaults: { date: string; deadline: string } }) {
  const t = useTranslations("trips");
  const tc = useTranslations("common");
  const err = useTripError();
  const router = useRouter();
  const blank: TripInput = { id: null, titleEn: "", titleAr: "", descEn: "", descAr: "", destinationEn: "", destinationAr: "", date: defaults.date, endDate: defaults.date, startTime: "08:00", endTime: "14:00", costAed: null, consentDeadline: defaults.deadline, gradeLevels: [], classIds: [] };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<TripInput>(initial ?? blank);
  const [pending, start] = useTransition();
  const set = <K extends keyof TripInput>(k: K, v: TripInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.titleEn.trim().length > 2 && f.destinationEn.trim().length > 1 && (f.gradeLevels.length > 0 || f.classIds.length > 0);
  const submit = () =>
    start(async () => {
      const res = await saveTripAction(f);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      setOpen(false);
      if (!initial && res.id) router.push(`/trips/${res.id}`);
      router.refresh();
    });
  return (
    <>
      {initial ? (
        <Button variant="outline" onClick={() => (setF(initial), setOpen(true))} data-testid="trip-edit">
          <Pencil className="size-4" />
          {tc("edit")}
        </Button>
      ) : (
        <Button onClick={() => (setF(blank), setOpen(true))} data-testid="new-trip">
          <Plus className="size-4" />
          {t("newTrip")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("editTrip") : t("newTrip")}</DialogTitle>
            <DialogDescription>{t("dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("fieldTitleEn")} htmlFor="tr-title-en">
                <Input id="tr-title-en" dir="ltr" value={f.titleEn} onChange={(e) => set("titleEn", e.target.value)} data-testid="trip-title-en" />
              </Field>
              <Field label={t("fieldTitleAr")} htmlFor="tr-title-ar">
                <Input id="tr-title-ar" dir="rtl" value={f.titleAr} onChange={(e) => set("titleAr", e.target.value)} data-testid="trip-title-ar" />
              </Field>
              <Field label={t("fieldDestinationEn")} htmlFor="tr-dest-en">
                <Input id="tr-dest-en" dir="ltr" value={f.destinationEn} onChange={(e) => set("destinationEn", e.target.value)} data-testid="trip-dest-en" />
              </Field>
              <Field label={t("fieldDestinationAr")} htmlFor="tr-dest-ar">
                <Input id="tr-dest-ar" dir="rtl" value={f.destinationAr} onChange={(e) => set("destinationAr", e.target.value)} />
              </Field>
              <Field label={t("fieldDescEn")} htmlFor="tr-desc-en">
                <Textarea id="tr-desc-en" dir="ltr" rows={3} value={f.descEn} onChange={(e) => set("descEn", e.target.value)} />
              </Field>
              <Field label={t("fieldDescAr")} htmlFor="tr-desc-ar">
                <Textarea id="tr-desc-ar" dir="rtl" rows={3} value={f.descAr} onChange={(e) => set("descAr", e.target.value)} />
              </Field>
              <Field label={t("fieldDate")} htmlFor="tr-date">
                <Input id="tr-date" type="date" value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value, endDate: p.endDate < e.target.value ? e.target.value : p.endDate }))} data-testid="trip-date" />
              </Field>
              <Field label={t("fieldEndDate")} htmlFor="tr-end-date">
                <Input id="tr-end-date" type="date" min={f.date} value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
              </Field>
              <Field label={t("fieldDeparts")} htmlFor="tr-st">
                <Input id="tr-st" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
              </Field>
              <Field label={t("fieldReturns")} htmlFor="tr-et">
                <Input id="tr-et" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} />
              </Field>
              <Field label={t("fieldCost")} htmlFor="tr-cost" hint={t("fieldCostHint")}>
                <Input id="tr-cost" type="number" min={0} value={f.costAed ?? ""} onChange={(e) => set("costAed", e.target.value === "" ? null : Number(e.target.value))} data-testid="trip-cost" />
              </Field>
              <Field label={t("fieldDeadline")} htmlFor="tr-deadline">
                <Input id="tr-deadline" type="date" max={f.date} value={f.consentDeadline} onChange={(e) => set("consentDeadline", e.target.value)} data-testid="trip-deadline" />
              </Field>
            </div>
            <Field label={t("fieldGrades")}>
              <GradePicker grades={grades} value={f.gradeLevels} onChange={(v) => set("gradeLevels", v)} testId="trip-grades" />
            </Field>
            <Field label={t("fieldClasses")} hint={t("fieldClassesHint")}>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-3">
                {classes.map((c) => (
                  <label key={c.value} className="flex cursor-pointer items-center gap-2 rounded-md p-1 text-sm hover:bg-muted/50">
                    <Checkbox checked={f.classIds.includes(c.value)} onCheckedChange={(v) => set("classIds", v ? [...f.classIds, c.value] : f.classIds.filter((x) => x !== c.value))} />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !valid} data-testid="trip-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("saveDraft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Confirm({ trigger, title, body, confirm, onConfirm, destructive, children, testId }: { trigger: React.ReactNode; title: string; body: string; confirm: string; onConfirm: () => Promise<boolean>; destructive?: boolean; children?: React.ReactNode; testId?: string }) {
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={() => start(async () => void ((await onConfirm()) && setOpen(false)))} data-testid={testId}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TripOrganiserActions({ id, status, ended, pending: pendingCount, participants }: { id: string; status: string; ended: boolean; pending: number; participants: number }) {
  const t = useTranslations("trips");
  const err = useTripError();
  const router = useRouter();
  const [reasonEn, setReasonEn] = useState("");
  const [reasonAr, setReasonAr] = useState("");
  const [busy, start] = useTransition();
  const ok = (msg: string) => {
    toast.success(msg);
    router.refresh();
    return true;
  };
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && (
        <>
          <Confirm
            trigger={
              <Button data-testid="trip-publish">
                <Send className="size-4" />
                {t("publish")}
              </Button>
            }
            title={t("publishTitle")}
            body={t("publishBody")}
            confirm={t("publishConfirm")}
            testId="trip-publish-confirm"
            onConfirm={async () => {
              const res = await publishTripAction(id);
              if (!res.ok) return (toast.error(err(res.error)), false);
              return ok(t("publishedToast", { count: res.count ?? 0 }));
            }}
          />
          <Confirm
            trigger={
              <Button variant="outline">
                <Trash2 className="size-4" />
                {t("deleteDraft")}
              </Button>
            }
            title={t("deleteDraftTitle")}
            body={t("deleteDraftBody")}
            confirm={t("deleteDraft")}
            destructive
            onConfirm={async () => {
              const res = await deleteDraftTripAction(id);
              if (!res.ok) return (toast.error(err(res.error)), false);
              router.push("/trips");
              return ok(t("deletedToast"));
            }}
          />
        </>
      )}
      {status === "PUBLISHED" && !ended && pendingCount === 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button variant="outline" disabled>
                <Bell className="size-4" />
                {t("remind", { count: 0 })}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("noPendingHint")}</TooltipContent>
        </Tooltip>
      )}
      {status === "PUBLISHED" && !ended && pendingCount > 0 && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const res = await remindTripAction(id);
              if (!res.ok) return void toast.error(err(res.error));
              if (res.alreadySentToday) return void toast.info(t("remindedAlready"));
              ok(t("remindedToast", { count: res.count ?? 0 }));
            })
          }
          data-testid="trip-remind"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
          {t("remind", { count: pendingCount })}
        </Button>
      )}
      {status !== "DRAFT" && participants > 0 && (
        <Button asChild variant="outline">
          <a href={`/api/trips/${id}/export`} data-testid="trip-export">
            <Download className="size-4" />
            {t("exportCsv")}
          </a>
        </Button>
      )}
      {status === "PUBLISHED" && ended && (
        <Confirm
          trigger={
            <Button variant="outline" data-testid="trip-complete">
              <CheckCircle2 className="size-4" />
              {t("markCompleted")}
            </Button>
          }
          title={t("completeTitle")}
          body={t("completeBody")}
          confirm={t("markCompleted")}
          onConfirm={async () => {
            const res = await completeTripAction(id);
            if (!res.ok) return (toast.error(err(res.error)), false);
            return ok(t("completedToast"));
          }}
        />
      )}
      {(status === "PUBLISHED" || status === "DRAFT") && !ended && (
        <Confirm
          trigger={
            <Button variant="outline" className="text-danger" data-testid="trip-cancel">
              <XCircle className="size-4" />
              {t("cancelTrip")}
            </Button>
          }
          title={t("cancelTitle")}
          body={status === "PUBLISHED" ? t("cancelBodyPublished") : t("cancelBodyDraft")}
          confirm={t("cancelTrip")}
          destructive
          testId="trip-cancel-confirm"
          onConfirm={async () => {
            const res = await cancelTripAction(id, reasonEn, reasonAr);
            if (!res.ok) return (toast.error(err(res.error)), false);
            return ok(t("cancelledToast", { count: res.count ?? 0 }));
          }}
        >
          {status === "PUBLISHED" && (
            <div className="grid gap-3">
              <Field label={t("reasonEn")} htmlFor="cx-en">
                <Textarea id="cx-en" dir="ltr" rows={2} value={reasonEn} onChange={(e) => setReasonEn(e.target.value)} />
              </Field>
              <Field label={t("reasonAr")} htmlFor="cx-ar">
                <Textarea id="cx-ar" dir="rtl" rows={2} value={reasonAr} onChange={(e) => setReasonAr(e.target.value)} />
              </Field>
            </div>
          )}
        </Confirm>
      )}
    </div>
  );
}

/** One tap to grant or decline, with an optional note. */
export function ConsentButtons({ participantId, current, childName }: { participantId: string; current: "PENDING" | "GRANTED" | "DECLINED"; childName: string }) {
  const t = useTranslations("trips");
  const err = useTripError();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [pending, start] = useTransition();
  const decide = (decision: "GRANTED" | "DECLINED") =>
    start(async () => {
      const res = await consentAction({ participantId, decision, note });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(decision === "GRANTED" ? t("grantedToast", { name: childName }) : t("declinedToast", { name: childName }));
      setNote("");
      setShowNote(false);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      {showNote ? (
        <Field label={t("noteLabel")} htmlFor={`note-${participantId}`}>
          <Textarea id={`note-${participantId}`} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} data-testid="consent-note" />
        </Field>
      ) : (
        <button type="button" onClick={() => setShowNote(true)} className="text-xs font-medium text-brand hover:underline">
          {t("addNote")}
        </button>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={() => decide("GRANTED")} disabled={pending} className="bg-success text-white hover:bg-success/90" data-testid="consent-grant">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {current === "GRANTED" ? t("keepGranted") : t("grant")}
        </Button>
        <Button variant="outline" onClick={() => decide("DECLINED")} disabled={pending} data-testid="consent-decline">
          <XCircle className="size-4" />
          {current === "DECLINED" ? t("keepDeclined") : t("decline")}
        </Button>
      </div>
    </div>
  );
}
