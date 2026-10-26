"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, Check, ClipboardCheck, Copy, CreditCard, GraduationCap, Loader2, Send, UserPlus } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bookAssessmentAction, enrollAction, extendOfferAction, makeOfferAction, markPaidAction, moveStageAction, recordAssessmentAction } from "@/server/admissions/actions";
import { ASSESSMENT_OUTCOMES, CLOSE_REASONS } from "@/server/admissions/config";
import type { EnrollResult } from "@/server/admissions/enroll";
import { Field, selectClass } from "./ui";

type Opt = { value: string; label: string };
export type DialogKind = "offer" | "extend" | "paid" | "enroll" | "close" | "assessment" | "outcome" | null;

function useAction() {
  const t = useTranslations("admissions.detail");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending, t, router };
}

const dubaiDateKey = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

/** Simple stage moves (review stages, waitlist, recording an acceptance) as buttons. */
export function MoveButtons({ applicationId, moves }: { applicationId: string; moves: Array<{ key: string; label: string }> }) {
  const { run, pending, t } = useAction();
  if (!moves.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="move-buttons">
      {moves.map((m) => (
        <Button key={m.key} size="sm" variant="outline" disabled={pending} onClick={() => run(() => moveStageAction({ applicationId, to: m.key }), t("movedTo", { stage: m.label }))} data-testid={`move-to-${m.key}`}>
          {m.label}
        </Button>
      ))}
    </div>
  );
}

export function OfferDialog({ open, onOpenChange, applicationId, offerDays, sections, full, seats }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; offerDays: number; sections: Opt[]; full: boolean; seats: string }) {
  const { run, pending, t } = useAction();
  const [deadline, setDeadline] = useState(dubaiDateKey(new Date(Date.now() + offerDays * 86_400_000)));
  const [section, setSection] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="offer-dialog">
        <DialogHeader>
          <DialogTitle>{t("offerTitle")}</DialogTitle>
          <DialogDescription>{t("offerBody")}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs">{seats}</p>
        <Field id="deadline" label={t("deadline")}>
          <Input id="deadline" type="date" dir="ltr" value={deadline} min={dubaiDateKey(new Date(Date.now() + 86_400_000))} onChange={(e) => setDeadline(e.target.value)} data-testid="offer-deadline" />
        </Field>
        {sections.length > 0 && (
          <Field id="section" label={t("section")} optional>
            <select id="section" className={selectClass} value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">{t("sectionLater")}</option>
              {sections.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {full && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
            <p className="font-medium">{t("gradeFull")}</p>
            <label className="flex items-center gap-2">
              <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} data-testid="offer-override" />
              {t("overrideLabel")}
            </label>
            {override && <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("overrideReason")} data-testid="offer-override-reason" />}
          </div>
        )}
        <DialogFooter>
          <Button disabled={pending || !deadline || (full && (!override || !reason.trim()))} onClick={() => run(() => makeOfferAction({ applicationId, deadline, section: section || null, override, overrideReason: reason }), t("offerMade"), () => onOpenChange(false))} data-testid="offer-submit">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t("offerSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExtendDialog({ open, onOpenChange, applicationId, current }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; current: string | null }) {
  const { run, pending, t } = useAction();
  const [deadline, setDeadline] = useState(dubaiDateKey(new Date(Math.max(Date.now(), current ? new Date(current).getTime() : 0) + 7 * 86_400_000)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("extendTitle")}</DialogTitle>
          <DialogDescription>{t("extendBody")}</DialogDescription>
        </DialogHeader>
        <Field id="ext" label={t("deadline")}>
          <Input id="ext" type="date" dir="ltr" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button disabled={pending} onClick={() => run(() => extendOfferAction({ applicationId, deadline }), t("extended"), () => onOpenChange(false))}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("extend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaidDialog({ open, onOpenChange, applicationId, amount }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; amount: string }) {
  const { run, pending, t } = useAction();
  const [ref, setRef] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="paid-dialog">
        <DialogHeader>
          <DialogTitle>{t("paidTitle")}</DialogTitle>
          <DialogDescription>{t("paidBody", { amount })}</DialogDescription>
        </DialogHeader>
        <Field id="ref" label={t("paymentRef")} optional hint={t("paymentRefHint")}>
          <Input id="ref" dir="ltr" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} data-testid="paid-ref" />
        </Field>
        <DialogFooter>
          <Button disabled={pending} onClick={() => run(() => markPaidAction({ applicationId, reference: ref.trim() || null }), t("paidDone"), () => onOpenChange(false))} data-testid="paid-submit">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            {t("markPaid")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CloseDialog({ open, onOpenChange, applicationId, to, label }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; to: "DECLINED" | "WITHDRAWN"; label: string }) {
  const { run, pending, t } = useAction();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState<"SCHOOL" | "FAMILY">(to === "DECLINED" ? "SCHOOL" : "FAMILY");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="close-dialog">
        <DialogHeader>
          <DialogTitle>{t("closeTitle", { stage: label })}</DialogTitle>
          <DialogDescription>{t(to === "DECLINED" ? "declineBody" : "withdrawBody")}</DialogDescription>
        </DialogHeader>
        {to === "DECLINED" && (
          <Field id="by" label={t("decidedBy")}>
            <select id="by" className={selectClass} value={by} onChange={(e) => setBy(e.target.value as "SCHOOL" | "FAMILY")}>
              <option value="SCHOOL">{t("bySchool")}</option>
              <option value="FAMILY">{t("byFamily")}</option>
            </select>
          </Field>
        )}
        <Field id="reason" label={t("reason")}>
          <select id="reason" className={selectClass} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="close-reason">
            <option value="" disabled>
              {t("chooseReason")}
            </option>
            {CLOSE_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`closeReason.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="note" label={t("note")} optional>
          <Textarea id="note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="destructive" disabled={pending || !reason} onClick={() => run(() => moveStageAction({ applicationId, to, reason, note, closedBy: by }), t("movedTo", { stage: label }), () => onOpenChange(false))} data-testid="close-submit">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssessmentDialog({ open, onOpenChange, applicationId, hosts, defaultHost }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; hosts: Opt[]; defaultHost: string | null }) {
  const { run, pending, t } = useAction();
  const [v, setV] = useState({ hostId: defaultHost ?? hosts[0]?.value ?? "", date: dubaiDateKey(new Date(Date.now() + 3 * 86_400_000)), time: "09:00", durationMin: 45, locationEn: "", locationAr: "" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="assessment-dialog">
        <DialogHeader>
          <DialogTitle>{t("assessTitle")}</DialogTitle>
          <DialogDescription>{t("assessBody")}</DialogDescription>
        </DialogHeader>
        {hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHosts")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="host" label={t("assessor")} className="sm:col-span-2">
              <select id="host" className={selectClass} value={v.hostId} onChange={(e) => setV({ ...v, hostId: e.target.value })} data-testid="assess-host">
                {hosts.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="adate" label={t("date")}>
              <Input id="adate" type="date" dir="ltr" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} data-testid="assess-date" />
            </Field>
            <Field id="atime" label={t("time")}>
              <Input id="atime" type="time" dir="ltr" step={300} value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} data-testid="assess-time" />
            </Field>
            <Field id="adur" label={t("duration")}>
              <select id="adur" className={selectClass} value={v.durationMin} onChange={(e) => setV({ ...v, durationMin: Number(e.target.value) })}>
                {[30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {t("minutes", { n: m })}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="aloc" label={t("location")} optional hint={t("locationHint")}>
              <Input id="aloc" value={v.locationEn} onChange={(e) => setV({ ...v, locationEn: e.target.value, locationAr: v.locationAr || "" })} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button disabled={pending || !v.hostId} onClick={() => run(() => bookAssessmentAction({ applicationId, ...v, locationEn: v.locationEn || null, locationAr: v.locationAr || null }), t("assessBooked"), () => onOpenChange(false))} data-testid="assess-submit">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
            {t("book")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OutcomeDialog({ open, onOpenChange, applicationId, current, notes }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; current: string | null; notes: string }) {
  const { run, pending, t } = useAction();
  const [outcome, setOutcome] = useState(current ?? "RECOMMENDED");
  const [text, setText] = useState(notes);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="outcome-dialog">
        <DialogHeader>
          <DialogTitle>{t("outcomeTitle")}</DialogTitle>
          <DialogDescription>{t("outcomeBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {ASSESSMENT_OUTCOMES.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={outcome === o} onClick={() => setOutcome(o)} className={`h-10 rounded-md border text-sm font-medium ${outcome === o ? "border-brand bg-brand-soft text-brand" : "bg-card"}`} data-testid={`outcome-${o}`}>
              {t(`outcome.${o}`)}
            </button>
          ))}
        </div>
        <Field id="onotes" label={t("outcomeNotes")} optional hint={t("outcomeNotesHint")}>
          <Textarea id="onotes" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button disabled={pending} onClick={() => run(() => recordAssessmentAction({ applicationId, outcome, notes: text }), t("outcomeSaved"), () => onOpenChange(false))} data-testid="outcome-submit">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
            {t("saveOutcome")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EnrollDialog({ open, onOpenChange, applicationId, homerooms, sections, readmit, defaultSection, startsLater }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; homerooms: Opt[]; sections: Opt[]; readmit: Opt[]; defaultSection: string | null; startsLater: boolean }) {
  const { pending, t, router } = useAction();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [homeroom, setHomeroom] = useState("");
  const [section, setSection] = useState(defaultSection ?? "");
  const [link, setLink] = useState("");
  const [invite, setInvite] = useState(true);
  const [result, setResult] = useState<EnrollResult | null>(null);
  useEffect(() => {
    if (!open) setResult(null);
  }, [open]);
  const enroll = () => {
    setBusy(true);
    start(async () => {
      const r = await enrollAction({ applicationId, homeroomClassId: homeroom || null, section: section || null, linkStudentId: link || null, sendInvites: invite });
      setBusy(false);
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      setResult(r.result);
      toast.success(t("enrolled"));
      router.refresh();
    });
  };
  const copy = async (token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("linkCopied"));
    } catch {
      toast.message(url);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="enroll-dialog">
        <DialogHeader>
          <DialogTitle>{result ? t("enrolledTitle") : t("enrollTitle")}</DialogTitle>
          <DialogDescription>{result ? t("enrolledBody", { no: result.admissionNo }) : t(startsLater ? "enrollBodyLater" : "enrollBody")}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm" data-testid="enroll-result">
            <ul className="space-y-1">
              <li className="flex items-center gap-2"><Check className="size-4 text-success" />{t("resultStudent", { no: result.admissionNo })}</li>
              <li className="flex items-center gap-2"><Check className="size-4 text-success" />{t("resultGuardians", { created: result.guardiansCreated, reused: result.guardiansReused })}</li>
              <li className="flex items-center gap-2"><Check className="size-4 text-success" />{t("resultDocs", { n: result.documentsCopied })}</li>
            </ul>
            {result.invitesSkipped && <p className="text-xs text-[oklch(0.5_0.13_65)]">{t("invitesSkipped")}</p>}
            {result.invites.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="font-medium">{t("invitesTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("invitesBody")}</p>
                {result.invites.map((i) => (
                  <div key={i.token} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs" dir="ltr">{i.email}</span>
                    <Button size="sm" variant="outline" onClick={() => copy(i.token)} data-testid="copy-invite">
                      <Copy className="size-3.5" />
                      {t("copyInvite")}
                    </Button>
                    <a href={`/join/${i.token}`} className="sr-only" data-testid="invite-link">{i.email}</a>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button asChild>
                <Link href={`/students/${result.studentId}`} data-testid="open-student">
                  <GraduationCap className="size-4" />
                  {t("openStudent")}
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            {readmit.length > 0 && (
              <Field id="link" label={t("readmit")} hint={t("readmitHint")}>
                <select id="link" className={selectClass} value={link} onChange={(e) => setLink(e.target.value)}>
                  <option value="">{t("newRecord")}</option>
                  {readmit.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {homerooms.length > 0 ? (
              <Field id="homeroom" label={t("homeroom")} optional>
                <select id="homeroom" className={selectClass} value={homeroom} onChange={(e) => setHomeroom(e.target.value)} data-testid="enroll-homeroom">
                  <option value="">{t("homeroomLater")}</option>
                  {homerooms.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <>
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{t("noHomerooms")}</p>
                {sections.length > 0 && (
                  <Field id="esection" label={t("section")} optional>
                    <select id="esection" className={selectClass} value={section} onChange={(e) => setSection(e.target.value)} data-testid="enroll-section">
                      <option value="">{t("sectionLater")}</option>
                      {sections.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            )}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={invite} onCheckedChange={(v) => setInvite(v === true)} data-testid="enroll-invite" />
              <span>
                {t("sendInvites")}
                <span className="block text-xs text-muted-foreground">{t("sendInvitesHint")}</span>
              </span>
            </label>
            <DialogFooter>
              <Button disabled={busy || pending} onClick={enroll} data-testid="enroll-submit">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {t("enroll")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

