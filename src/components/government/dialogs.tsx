"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, CheckCircle2, FilePlus2, Loader2, PenLine, Send, ShieldCheck, Trash2, Undo2, Wrench } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  createReturnAction,
  deleteDueDateAction,
  deleteReturnAction,
  fixStudentAction,
  logSubmissionAction,
  recordReferenceAction,
  saveDueDateAction,
  setDueDoneAction,
  signOffAction,
} from "@/server/govreports/actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60";

const today = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

function Field({ id, label, hint, children, className }: { id: string; label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Run a server action, show its error or success, refresh the page. */
function useRun() {
  const t = useTranslations("govReports");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { pending, run, router };
}

// ---------------------------------------------------------------------------
// New return
// ---------------------------------------------------------------------------

const KINDS = ["CENSUS", "REGISTRATION", "ATTENDANCE", "STAFF", "RESULTS"] as const;

export function NewReturnButton({ dues, preset, variant = "default", label }: { dues: Array<{ id: string; title: string; kind: string; dueOn: string }>; preset?: { dueId: string; kind: string; dueOn: string } | null; variant?: "default" | "outline" | "ghost"; label?: string }) {
  const t = useTranslations("govReports");
  const { pending, router } = useRun();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>(preset?.kind && preset.kind !== "OTHER" ? preset.kind : "CENSUS");
  const [asOf, setAsOf] = useState(preset?.dueOn ?? today());
  const [from, setFrom] = useState("");
  const [name, setName] = useState("");
  const [due, setDue] = useState(preset?.dueId ?? "");
  const create = () =>
    start(async () => {
      const r = await createReturnAction({ kind, asOf, periodFrom: kind === "STAFF" ? null : from || null, label: name || null, dueDateId: due || null });
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(t("new.created"));
      setOpen(false);
      router.push(`/admin/government/${r.id}`);
    });
  const asOfLabel = kind === "CENSUS" ? t("new.asOfCensus") : kind === "STAFF" ? t("new.asOfStaff") : t("new.asOfPeriod");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={variant === "ghost" ? "sm" : "default"} data-testid={preset ? "gov-start-return" : "gov-new-return"}>
          <FilePlus2 className="size-4" />
          {label ?? t("new.button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="gov-new-dialog">
        <DialogHeader>
          <DialogTitle>{t("new.title")}</DialogTitle>
          <DialogDescription>{t("new.body")}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">{t("new.kind")}</legend>
          {KINDS.map((k) => (
            <label key={k} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition", kind === k ? "border-brand bg-brand-soft/40" : "hover:bg-muted/50")}>
              <input type="radio" name="gov-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-1 accent-[var(--brand)]" data-testid={`gov-kind-${k}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(`kind.${k}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`kindHelp.${k}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="gov-asof" label={asOfLabel}>
            <Input id="gov-asof" type="date" dir="ltr" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="gov-asof" />
          </Field>
          {kind !== "STAFF" && (
            <Field id="gov-from" label={t("new.from")} hint={t("new.fromHelp")}>
              <Input id="gov-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          )}
        </div>
        <Field id="gov-label" label={t("new.label")}>
          <Input id="gov-label" maxLength={80} value={name} placeholder={t("new.labelPlaceholder")} onChange={(e) => setName(e.target.value)} />
        </Field>
        {dues.length > 0 && (
          <Field id="gov-due" label={t("new.due")}>
            <select id="gov-due" className={selectClass} value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="">{t("new.noDue")}</option>
              {dues.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <DialogFooter>
          <Button onClick={create} disabled={busy || pending || !asOf} data-testid="gov-create">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("new.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteReturnButton({ returnId }: { returnId: string }) {
  const t = useTranslations("govReports");
  const { pending, run, router } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-danger hover:text-danger">
          <Trash2 className="size-4" />
          {t("detail.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("detail.delete")}</DialogTitle>
          <DialogDescription>{t("detail.deleteConfirm")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteReturnAction({ returnId }), t("detail.deleted"), () => router.push("/admin/government"))}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("detail.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sign-off and submission
// ---------------------------------------------------------------------------

export function SignOffButton({ returnId, signer, problems, signed }: { returnId: string; signer: string; problems: number; signed: boolean }) {
  const t = useTranslations("govReports");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={signed ? "outline" : "default"} data-testid="gov-signoff">
          <ShieldCheck className="size-4" />
          {signed ? t("signOff.again") : t("signOff.button")}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="gov-signoff-dialog">
        <DialogHeader>
          <DialogTitle>{t("signOff.title")}</DialogTitle>
          <DialogDescription>{t("signOff.body")}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium">{t("signOff.as", { name: signer })}</div>
        {problems > 0 && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm">{t("signOff.problems", { n: problems })}</p>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={ok} onCheckedChange={(v) => setOk(v === true)} data-testid="gov-signoff-confirm" />
          {t("signOff.confirm")}
        </label>
        <DialogFooter>
          <Button disabled={!ok || pending} onClick={() => run(() => signOffAction({ returnId, confirm: true }), t("signOff.saved"), () => setOpen(false))} data-testid="gov-signoff-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("signOff.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SubmissionButton({ returnId, files, authority, signed }: { returnId: string; files: Array<{ id: string; label: string; sheet: boolean }>; authority: string; signed: boolean }) {
  const t = useTranslations("govReports");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState((files.find((f) => f.sheet) ?? files[0])?.id ?? "");
  const [on, setOn] = useState(today());
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="gov-submit">
          <Send className="size-4" />
          {t("submit.button")}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="gov-submit-dialog">
        <DialogHeader>
          <DialogTitle>{t("submit.title")}</DialogTitle>
          <DialogDescription>{t("submit.body", { authority })}</DialogDescription>
        </DialogHeader>
        {!files.length ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t("submit.needFile")}</p>
        ) : (
          <>
            {!signed && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm">{t("submit.notSigned")}</p>}
            <Field id="gov-sub-file" label={t("submit.file")}>
              <select id="gov-sub-file" className={selectClass} value={file} onChange={(e) => setFile(e.target.value)} data-testid="gov-sub-file">
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="gov-sub-date" label={t("submit.date")}>
                <Input id="gov-sub-date" type="date" dir="ltr" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />
              </Field>
              <Field id="gov-sub-ref" label={t("submit.ref")}>
                <Input id="gov-sub-ref" dir="ltr" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} data-testid="gov-sub-ref" />
              </Field>
            </div>
            <Field id="gov-sub-note" label={t("submit.note")}>
              <Textarea id="gov-sub-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
        <DialogFooter>
          <Button disabled={!files.length || !ref.trim() || !on || pending} onClick={() => run(() => logSubmissionAction({ returnId, exportId: file, submittedOn: on, reference: ref.trim(), note: note.trim() || null }), t("submit.saved"), () => setOpen(false))} data-testid="gov-sub-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("submit.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

export function FixStudentButton({ studentId, name, missing, nationalities }: { studentId: string; name: string; missing: Array<"dob" | "gender" | "nationality" | "eid">; nationalities: Array<{ code: string; label: string }> }) {
  const t = useTranslations("govReports");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [nat, setNat] = useState("");
  const [eid, setEid] = useState("");
  const has = (f: string) => missing.includes(f as never);
  const filled = (has("dob") && dob) || (has("gender") && gender) || (has("nationality") && nat) || (has("eid") && eid.replace(/\D/g, "").length === 15);
  const save = () =>
    run(
      () => fixStudentAction({ studentId, dateOfBirth: has("dob") && dob ? dob : null, gender: has("gender") && gender ? gender : null, nationality: has("nationality") && nat ? nat : null, emiratesId: has("eid") && eid ? eid : null }),
      t("fix.saved"),
      () => setOpen(false),
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8" data-testid="gov-fix">
          <Wrench className="size-3.5" />
          {t("fix.button")}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="gov-fix-dialog">
        <DialogHeader>
          <DialogTitle>{t("fix.title", { name })}</DialogTitle>
          <DialogDescription>{t("fix.body")}</DialogDescription>
        </DialogHeader>
        {has("dob") && (
          <Field id="fix-dob" label={t("fix.dob")}>
            <Input id="fix-dob" type="date" dir="ltr" value={dob} max={today()} onChange={(e) => setDob(e.target.value)} />
          </Field>
        )}
        {has("gender") && (
          <Field id="fix-gender" label={t("fix.gender")}>
            <select id="fix-gender" className={selectClass} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">{t("fix.choose")}</option>
              <option value="F">{t("gender.F")}</option>
              <option value="M">{t("gender.M")}</option>
            </select>
          </Field>
        )}
        {has("nationality") && (
          <Field id="fix-nat" label={t("fix.nationality")}>
            <select id="fix-nat" className={selectClass} value={nat} onChange={(e) => setNat(e.target.value)} data-testid="gov-fix-nationality">
              <option value="">{t("fix.choose")}</option>
              {nationalities.map((n) => (
                <option key={n.code} value={n.code}>
                  {n.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {has("eid") && (
          <Field id="fix-eid" label={t("fix.eid")} hint={t("fix.eidHelp")}>
            <Input id="fix-eid" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={18} placeholder="784-0000-0000000-0" value={eid} onChange={(e) => setEid(e.target.value)} data-testid="gov-fix-eid" />
          </Field>
        )}
        <DialogFooter>
          <Button disabled={!filled || pending} onClick={save} data-testid="gov-fix-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("fix.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReferenceButton({ studentId, name, authority }: { studentId: string; name: string; authority: string }) {
  const t = useTranslations("govReports");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"SUBMITTED" | "APPROVED">("APPROVED");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(today());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8" data-testid="gov-ref">
          <PenLine className="size-3.5" />
          {t("reference.button")}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="gov-ref-dialog">
        <DialogHeader>
          <DialogTitle>{t("reference.title", { name })}</DialogTitle>
          <DialogDescription>{t("reference.body", { authority })}</DialogDescription>
        </DialogHeader>
        <Field id="ref-status" label={t("reference.status")}>
          <select id="ref-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as "SUBMITTED" | "APPROVED")}>
            <option value="APPROVED">{t("reference.approved")}</option>
            <option value="SUBMITTED">{t("reference.submitted")}</option>
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ref-ref" label={t("reference.ref")}>
            <Input id="ref-ref" dir="ltr" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} data-testid="gov-ref-input" />
          </Field>
          <Field id="ref-date" label={t("reference.date")}>
            <Input id="ref-date" type="date" dir="ltr" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={!ref.trim() || !date || pending} onClick={() => run(() => recordReferenceAction({ studentId, status, reference: ref.trim(), date }), t("reference.saved"), () => setOpen(false))} data-testid="gov-ref-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("reference.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

type DueInit = { id: string; titleEn: string; titleAr: string; kind: string; dueOn: string; notes: string | null };

export function DueDateButton({ initial }: { initial?: DueInit }) {
  const t = useTranslations("govReports");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [titleEn, setTitleEn] = useState(initial?.titleEn ?? "");
  const [titleAr, setTitleAr] = useState(initial?.titleAr ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "CENSUS");
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <Button size="sm" variant="ghost" className="h-8">
            <PenLine className="size-3.5" />
            {t("due.edit")}
          </Button>
        ) : (
          <Button variant="outline" data-testid="gov-due-add">
            <CalendarPlus className="size-4" />
            {t("due.add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent data-testid="gov-due-dialog">
        <DialogHeader>
          <DialogTitle>{t("due.title")}</DialogTitle>
          <DialogDescription>{t("due.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="due-en" label={t("due.titleEn")}>
            <Input id="due-en" dir="ltr" maxLength={120} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} data-testid="gov-due-title-en" />
          </Field>
          <Field id="due-ar" label={t("due.titleAr")}>
            <Input id="due-ar" dir="rtl" maxLength={120} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />
          </Field>
          <Field id="due-kind" label={t("due.kind")}>
            <select id="due-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              {[...KINDS, "OTHER"].map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="due-on" label={t("due.dueOn")}>
            <Input id="due-on" type="date" dir="ltr" value={dueOn} onChange={(e) => setDueOn(e.target.value)} data-testid="gov-due-on" />
          </Field>
        </div>
        <Field id="due-notes" label={t("due.notes")}>
          <Textarea id="due-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button disabled={(!titleEn.trim() && !titleAr.trim()) || !dueOn || pending} onClick={() => run(() => saveDueDateAction({ id: initial?.id ?? null, titleEn, titleAr, kind, dueOn, notes: notes || null }), t("due.saved"), () => setOpen(false))} data-testid="gov-due-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("due.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DueDoneButton({ id, done }: { id: string; done: boolean }) {
  const t = useTranslations("govReports");
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="ghost" className="h-8" disabled={pending} onClick={() => run(() => setDueDoneAction({ id, done: !done }), t("due.saved"))}>
      {done ? <Undo2 className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
      {done ? t("due.reopen") : t("due.done")}
    </Button>
  );
}

export function DueDeleteButton({ id }: { id: string }) {
  const t = useTranslations("govReports");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 text-danger hover:text-danger">
          <Trash2 className="size-3.5" />
          {t("due.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("due.delete")}</DialogTitle>
          <DialogDescription>{t("due.deleteConfirm")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteDueDateAction({ id }), t("due.deleted"), () => setOpen(false))}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("due.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
