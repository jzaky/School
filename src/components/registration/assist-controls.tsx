"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgeCheck, CalendarClock, HandHelping, Loader2, ShieldCheck, Sparkles, UserMinus, UserPlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { dubaiParts } from "@/lib/selection-window";
import { initials } from "@/lib/i18n-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import { grantExceptionAction, grantHelperAction, revokeExceptionAction, revokeHelperAction, signOffAction } from "@/server/registration/selection-actions";

export function useSelError() {
  const t = useTranslations("selection");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export type HelperCandidate = { membershipId: string; name: string; role: string; kind: "STAFF" | "GUARDIAN" };
export type ActiveHelper = { id: string; name: string; role: string; until: string; untilText: string; byStudent: boolean; grantedBy: string; kind: "STAFF" | "GUARDIAN" };

/** Date and time inputs in Dubai time, side by side (they fit a 390px phone). */
function DubaiDateTime({ id, date, time, onDate, onTime, min }: { id: string; date: string; time: string; onDate: (v: string) => void; onTime: (v: string) => void; min?: string }) {
  const t = useTranslations("selection");
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <Input id={id} type="date" value={date} min={min} onChange={(e) => onDate(e.target.value)} dir="ltr" data-testid={`${id}-date`} />
        <Input type="time" value={time} onChange={(e) => onTime(e.target.value)} dir="ltr" step={300} aria-label={t("timeLabel")} data-testid={`${id}-time`} />
      </div>
      <p className="text-xs text-muted-foreground">{t("dubaiHint")}</p>
    </div>
  );
}

/**
 * "Let someone help me" (the student) or "Turn on assisted choosing" (staff): pick a teacher, counselor,
 * advisor or (when the school allows it) a parent, optionally until a date (default: the window close).
 */
export function GrantHelperDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  candidates,
  defaultUntil,
  asStaff,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studentId: string;
  studentName: string;
  candidates: HelperCandidate[];
  defaultUntil: string | null;
  asStaff: boolean;
}) {
  const t = useTranslations("selection.help");
  const err = useSelError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [helperId, setHelperId] = useState<string>(candidates[0]?.membershipId ?? "");
  const initial = defaultUntil ? dubaiParts(new Date(defaultUntil)) : { date: "", time: "15:00" };
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [reason, setReason] = useState("");
  const today = dubaiParts(new Date()).date;
  const staff = candidates.filter((c) => c.kind === "STAFF");
  const parents = candidates.filter((c) => c.kind === "GUARDIAN");

  const save = () =>
    start(async () => {
      const res = await grantHelperAction({ studentId, helperId, untilDate: date || null, untilTime: date ? time : null, reason: reason || null });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("granted", { name: candidates.find((c) => c.membershipId === helperId)?.name ?? "" }));
      onOpenChange(false);
      router.refresh();
    });

  const option = (c: HelperCandidate) => (
    <button
      key={c.membershipId}
      type="button"
      role="radio"
      aria-checked={helperId === c.membershipId}
      onClick={() => setHelperId(c.membershipId)}
      className={cn("flex w-full items-center gap-3 rounded-lg border p-2.5 text-start transition-colors", helperId === c.membershipId ? "border-brand bg-brand-soft/60 ring-1 ring-brand/30" : "hover:bg-muted/40")}
      data-testid={`helper-option-${c.membershipId}`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{initials(c.name)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{c.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{c.role}</span>
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{asStaff ? t("staffTitle", { name: studentName }) : t("title")}</DialogTitle>
          <DialogDescription>{asStaff ? t("staffBody", { name: studentName }) : t("body")}</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">{t("noCandidates")}</p>
        ) : (
          <div className="space-y-3" role="radiogroup" aria-label={t("pickLabel")}>
            {staff.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{t("groupStaff")}</div>
                {staff.map(option)}
              </div>
            )}
            {parents.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{t("groupParents")}</div>
                {parents.map(option)}
              </div>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="helper-until">{t("untilLabel")}</Label>
          <DubaiDateTime id="helper-until" date={date} time={time} onDate={setDate} onTime={setTime} min={today} />
          {!date && <p className="text-xs text-muted-foreground">{t("untilDefault")}</p>}
        </div>
        {asStaff && (
          <div className="space-y-1.5">
            <Label htmlFor="helper-reason">{t("reasonLabel")}</Label>
            <Textarea id="helper-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder={t("reasonPlaceholder")} />
          </div>
        )}
        <p className="flex items-start gap-1.5 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          {t("scopeNote")}
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending || !helperId || candidates.length === 0} data-testid="helper-save">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The student's card on "Choose my courses": who can help now, revoke, and "Let someone help me". */
export function HelpersCard({
  studentId,
  studentName,
  helpers,
  candidates,
  defaultUntil,
  canGrant,
  canRevoke,
  asStaff = false,
}: {
  studentId: string;
  studentName: string;
  helpers: ActiveHelper[];
  candidates: HelperCandidate[];
  defaultUntil: string | null;
  canGrant: boolean;
  canRevoke: boolean;
  asStaff?: boolean;
}) {
  const t = useTranslations("selection.help");
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs" data-testid="helpers-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <HandHelping className="mt-0.5 size-4 shrink-0 text-brand" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{asStaff ? t("cardTitleStaff") : t("cardTitle")}</h2>
            <p className="text-xs text-muted-foreground">{helpers.length ? (asStaff ? t("cardActiveStaff", { name: studentName }) : t("cardActive")) : asStaff ? t("cardEmptyStaff", { name: studentName }) : t("cardEmpty")}</p>
          </div>
        </div>
        {canGrant && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="let-someone-help">
            <UserPlus className="size-4" />
            {asStaff ? t("turnOn") : t("letHelp")}
          </Button>
        )}
      </div>
      {helpers.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border" data-testid="helper-list">
          {helpers.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="helper-row">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{initials(h.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{h.name}</div>
                <div className="text-xs text-muted-foreground">
                  {h.role} · {t("untilShort", { date: h.untilText })}
                </div>
                {!h.byStudent && <div className="truncate text-xs text-muted-foreground">{t("allowedBy", { name: h.grantedBy })}</div>}
              </div>
              {canRevoke && <RevokeHelperButton id={h.id} name={h.name} />}
            </li>
          ))}
        </ul>
      )}
      {canGrant && <GrantHelperDialog open={open} onOpenChange={setOpen} studentId={studentId} studentName={studentName} candidates={candidates} defaultUntil={defaultUntil} asStaff={asStaff} />}
    </section>
  );
}

export function RevokeHelperButton({ id, name, label }: { id: string; name: string; label?: string }) {
  const t = useTranslations("selection.help");
  const err = useSelError();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" className="shrink-0 text-danger hover:text-danger" onClick={() => setConfirm(true)} data-testid="helper-revoke">
        <UserMinus className="size-4" />
        <span className={label ? "" : "sr-only sm:not-sr-only"}>{label ?? t("revoke")}</span>
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("revokeTitle", { name })}</DialogTitle>
            <DialogDescription>{t("revokeBody", { name })}</DialogDescription>
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
                  const res = await revokeHelperAction({ id });
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("revoked", { name }));
                  setConfirm(false);
                  router.refresh();
                })
              }
              data-testid="helper-revoke-confirm"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Allow changes until <date>" for one student, with a required reason. */
export function ExceptionButton({ studentId, studentName, yearId, defaultUntil, variant = "outline" }: { studentId: string; studentName: string; yearId: string; defaultUntil?: string | null; variant?: "outline" | "ghost" }) {
  const t = useTranslations("selection.exception");
  const err = useSelError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const base = defaultUntil ? new Date(defaultUntil) : new Date(Date.now() + 3 * 86_400_000);
  const initial = dubaiParts(base);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(defaultUntil ? initial.time : "15:00");
  const [reason, setReason] = useState("");
  const today = dubaiParts(new Date()).date;
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} data-testid="allow-changes">
        <Sparkles className="size-4" />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("title", { name: studentName })}</DialogTitle>
            <DialogDescription>{t("body", { name: studentName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="exception-until">{t("untilLabel")}</Label>
            <DubaiDateTime id="exception-until" date={date} time={time} onDate={setDate} onTime={setTime} min={today} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exception-reason">{t("reasonLabel")}</Label>
            <Textarea id="exception-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={t("reasonPlaceholder")} data-testid="exception-reason" />
            <p className="text-xs text-muted-foreground">{t("reasonHint")}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending || reason.trim().length < 3 || !date}
              onClick={() =>
                start(async () => {
                  const res = await grantExceptionAction({ studentId, yearId, untilDate: date, untilTime: time, reason });
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("granted", { name: studentName }));
                  setOpen(false);
                  router.refresh();
                })
              }
              data-testid="exception-save"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RevokeExceptionButton({ id }: { id: string }) {
  const t = useTranslations("selection.exception");
  const err = useSelError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-danger hover:text-danger"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await revokeExceptionAction({ id });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("revoked"));
          router.refresh();
        })
      }
      data-testid="exception-revoke"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {t("revoke")}
    </Button>
  );
}

/** A parent (or the student, when a parent chose) confirms submitted choices. */
export function SignOffButton({ studentId, yearId, studentName }: { studentId: string; yearId: string; studentName: string }) {
  const t = useTranslations("selection.signOff");
  const err = useSelError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      className="w-full sm:w-auto"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await signOffAction({ studentId, yearId });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("done", { name: studentName }));
          router.refresh();
        })
      }
      data-testid="sign-off"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
      {t("button")}
    </Button>
  );
}

export function StatusPill({ status }: { status: "not_started" | "in_progress" | "submitted" | "signed_off" }) {
  const t = useTranslations("selection.status");
  const tone = status === "signed_off" ? "success" : status === "submitted" ? "info" : status === "in_progress" ? "warning" : "neutral";
  return (
    <Pill tone={tone} dot>
      <span data-testid="status-pill" data-status={status}>
        {t(status)}
      </span>
    </Pill>
  );
}
