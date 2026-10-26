"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, CalendarCheck, Check, Loader2, LogOut } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Panel, PanelHeader } from "@/components/app/panel";
import { openWindowAction, reenrollmentResponseAction, sendRemindersAction, updateWindowAction } from "@/server/admissions/actions";
import { LEAVING_REASONS } from "@/server/admissions/config";
import { Field, selectClass } from "./ui";

type Opt = { value: string; label: string };
const day = (offset: number) => new Date(Date.now() + 4 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

function useRun() {
  const t = useTranslations("admissions.reenroll");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string | ((r: never) => string), after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(typeof ok === "string" ? ok : ok(r as never));
      after?.();
      router.refresh();
    });
  return { t, run, pending };
}

export function OpenWindowForm({ years }: { years: Opt[] }) {
  const { t, run, pending } = useRun();
  const [v, setV] = useState({ academicYearId: years[0]?.value ?? "", opensOn: day(0), closesOn: day(21), messageEn: "", messageAr: "", d7: true, d2: true });
  return (
    <Panel>
      <PanelHeader title={t("openTitle")} description={t("openBody")} icon={<CalendarCheck className="size-4" />} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="ry" label={t("forYear")}>
          <select id="ry" className={selectClass} value={v.academicYearId} onChange={(e) => setV({ ...v, academicYearId: e.target.value })}>
            {years.map((y) => (
              <option key={y.value} value={y.value}>
                {y.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="ro" label={t("opensOn")}>
          <Input id="ro" type="date" dir="ltr" value={v.opensOn} onChange={(e) => setV({ ...v, opensOn: e.target.value })} />
        </Field>
        <Field id="rc" label={t("closesOn")}>
          <Input id="rc" type="date" dir="ltr" value={v.closesOn} onChange={(e) => setV({ ...v, closesOn: e.target.value })} data-testid="window-closes" />
        </Field>
        <Field id="rme" label={t("messageEn")} optional className="sm:col-span-3">
          <Textarea id="rme" rows={2} maxLength={1000} value={v.messageEn} onChange={(e) => setV({ ...v, messageEn: e.target.value })} dir="ltr" />
        </Field>
        <Field id="rma" label={t("messageAr")} optional className="sm:col-span-3">
          <Textarea id="rma" rows={2} maxLength={1000} value={v.messageAr} onChange={(e) => setV({ ...v, messageAr: e.target.value })} dir="rtl" />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <span className="text-muted-foreground">{t("autoReminders")}</span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={v.d7} onChange={(e) => setV({ ...v, d7: e.target.checked })} className="accent-[var(--brand)]" />
          {t("daysBefore", { n: 7 })}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={v.d2} onChange={(e) => setV({ ...v, d2: e.target.checked })} className="accent-[var(--brand)]" />
          {t("daysBefore", { n: 2 })}
        </label>
      </div>
      <Button className="mt-4" disabled={pending || !v.academicYearId} onClick={() => run(() => openWindowAction({ academicYearId: v.academicYearId, opensOn: v.opensOn, closesOn: v.closesOn, messageEn: v.messageEn, messageAr: v.messageAr, reminderDays: [...(v.d7 ? [7] : []), ...(v.d2 ? [2] : [])] }), t("opened"))} data-testid="open-window">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t("open")}
      </Button>
    </Panel>
  );
}

export function WindowActions({ windowId, state, closes, pending: waiting }: { windowId: string; state: string; closes: string; pending: number }) {
  const { t, run, pending } = useRun();
  const [date, setDate] = useState(closes);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3 shadow-xs">
      <Button size="sm" disabled={pending || state !== "open" || waiting === 0} title={state !== "open" ? t("notOpenYet") : waiting === 0 ? t("allAnswered") : undefined} onClick={() => run(() => sendRemindersAction({ windowId }), ((r: { sent: number }) => t("remindersSent", { n: r.sent })) as never)} data-testid="send-reminders">
        <BellRing className="size-4" />
        {t("sendReminders")}
      </Button>
      <div className="flex items-end gap-2">
        <Field id="ext" label={t("closesOn")}>
          <Input id="ext" type="date" dir="ltr" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button size="sm" variant="outline" disabled={pending || date === closes} onClick={() => run(() => updateWindowAction({ windowId, closesOn: date }), t("extended"))}>
          {t("changeDate")}
        </Button>
      </div>
      <Button size="sm" variant="ghost" className="ms-auto" disabled={pending} onClick={() => run(() => updateWindowAction({ windowId, close: true }), t("closed"))}>
        {t("closeNow")}
      </Button>
      <p className="w-full text-xs text-muted-foreground">{t("remindersNote")}</p>
    </div>
  );
}

/** Staff record an answer the family gave by phone or at the office. */
export function RecordAnswer({ windowId, studentId, current }: { windowId: string; studentId: string; current: string | null }) {
  const { t, run, pending } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7">
          {current ? t("change") : t("record")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("recordTitle")}</DialogTitle>
          <DialogDescription>{t("recordBody")}</DialogDescription>
        </DialogHeader>
        <AnswerForm pending={pending} onSubmit={(v) => run(() => reenrollmentResponseAction({ windowId, studentId, ...v }), t("saved"), () => setOpen(false))} initial={current} />
      </DialogContent>
    </Dialog>
  );
}

type Intent = "RETURNING" | "LEAVING";
type Answer = { intent: Intent; reasonKey: string | null; reasonNote: string | null; leavingDate: string | null };

function AnswerForm({ onSubmit, pending, initial }: { onSubmit: (v: Answer) => void; pending: boolean; initial: string | null }) {
  const t = useTranslations("admissions.reenroll");
  const tr = useTranslations("admissions.leavingReason");
  // Nothing is chosen until the family (or staff) picks an answer, so an unanswered child never looks answered.
  const [intent, setIntent] = useState<Intent | null>(initial === "LEAVING" || initial === "RETURNING" ? initial : null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {(["RETURNING", "LEAVING"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={intent === k} onClick={() => setIntent(k)} className={cn("flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium", intent === k ? (k === "RETURNING" ? "border-success bg-success-soft text-success" : "border-danger bg-danger-soft text-danger") : "bg-card")} data-testid={`intent-${k}`}>
            {k === "RETURNING" ? <Check className="size-4" /> : <LogOut className="size-4" />}
            {t(k === "RETURNING" ? "returningAnswer" : "leavingAnswer")}
          </button>
        ))}
      </div>
      {intent === "LEAVING" && (
        <>
          <Field id="lr" label={t("reason")}>
            <select id="lr" className={selectClass} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="leaving-reason">
              <option value="" disabled>
                {t("chooseReason")}
              </option>
              {LEAVING_REASONS.filter((r) => r !== "graduation").map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ld" label={t("leavingDate")} optional hint={t("leavingDateHint")}>
            <Input id="ld" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="ln" label={t("note")} optional>
            <Textarea id="ln" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}
      <DialogFooter>
        <Button disabled={pending || !intent || (intent === "LEAVING" && !reason)} title={!intent ? t("chooseFirst") : intent === "LEAVING" && !reason ? t("chooseReason") : undefined} onClick={() => intent && onSubmit({ intent, reasonKey: intent === "LEAVING" ? reason : null, reasonNote: note || null, leavingDate: intent === "LEAVING" && date ? date : null })} data-testid="answer-save">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("save")}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** The family's re-enrollment card for one child. */
export function ChildAnswer({ windowId, studentId, name, grade, current, reason }: { windowId: string; studentId: string; name: string; grade: string; current: string | null; reason: string | null }) {
  const { t, run, pending } = useRun();
  const tr = useTranslations("admissions.leavingReason");
  const [editing, setEditing] = useState(!current);
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs" data-testid="child-answer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">{grade}</div>
        </div>
        {!current && <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-[oklch(0.5_0.13_65)]">{t("noAnswer")}</span>}
        {current && !editing && (
          <div className="flex items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", current === "RETURNING" ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              {t(current === "RETURNING" ? "familyReturning" : "familyLeaving")}
              {current === "LEAVING" && reason ? ` · ${tr(reason)}` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t("change")}
            </Button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3">
          <AnswerForm pending={pending} initial={current} onSubmit={(v) => run(() => reenrollmentResponseAction({ windowId, studentId, ...v }), t("thanks"), () => setEditing(false))} />
        </div>
      )}
    </div>
  );
}
