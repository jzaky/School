"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { History, Loader2, Lock, Pencil, Plus, Send, ShieldAlert } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import {
  addExternalReferralAction,
  addNoteAction,
  amendNoteAction,
  breakGlassAction,
  grantAccessAction,
  recordParentDecisionAction,
  revokeAccessAction,
  sendCaseMessageAction,
  updateCaseAction,
} from "@/server/cases/actions";
import { createTaskAction } from "@/server/tasks/actions";

function useRun() {
  const router = useRouter();
  const t = useTranslations("caseForms");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(res.error && t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
    });
  return { pending, run };
}

export function NoteComposer({ caseId, sensitive }: { caseId: string; sensitive: boolean }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [kind, setKind] = useState<"NOTE" | "DECISION" | "CONTACT" | "ACTION">("NOTE");
  const [body, setBody] = useState("");
  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap gap-1.5">
        {(["NOTE", "ACTION", "CONTACT", "DECISION"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", kind === k ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}>
            {t(`kind.${k}`)}
          </button>
        ))}
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={t("notePlaceholder")} data-testid="note-body" />
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          {sensitive ? t("immutableSensitive") : t("immutable")}
        </p>
        <Button size="sm" disabled={pending || !body.trim()} onClick={() => run(() => addNoteAction({ caseId, kind, body }), t("noteAdded"), () => setBody(""))} data-testid="add-note">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("addNote")}
        </Button>
      </div>
    </div>
  );
}

export function AmendNote({ noteId, current, versions }: { noteId: string; current: string; versions: Array<{ version: number; body: string; when: string; who: string; reason: string | null }> }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [open, setOpen] = useState<"amend" | "history" | null>(null);
  const [body, setBody] = useState(current);
  const [reason, setReason] = useState("");
  return (
    <>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen("amend")}>
          <Pencil className="size-3" />
          {t("amend")}
        </Button>
        {versions.length > 1 && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen("history")}>
            <History className="size-3" />
            {t("versions", { count: versions.length })}
          </Button>
        )}
      </div>
      <Dialog open={open === "amend"} onOpenChange={(o) => setOpen(o ? "amend" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("amendTitle")}</DialogTitle>
            <DialogDescription>{t("amendHint")}</DialogDescription>
          </DialogHeader>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
          <div className="space-y-1.5">
            <Label>{t("amendReason")}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button disabled={pending || !reason.trim()} onClick={() => run(() => amendNoteAction({ noteId, body, reason }), t("amended"), () => setOpen(null))}>
              {t("saveVersion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open === "history"} onOpenChange={(o) => setOpen(o ? "history" : null)}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("historyTitle")}</DialogTitle>
          </DialogHeader>
          <ol className="space-y-4">
            {versions.map((v) => (
              <li key={v.version} className="rounded-lg border p-3">
                <div className="mb-1 text-xs text-muted-foreground">
                  {t("versionLine", { version: v.version, who: v.who, when: v.when })}
                </div>
                <p className="whitespace-pre-line text-sm">{v.body}</p>
                {v.reason && <p className="mt-2 text-xs text-muted-foreground">{t("reasonLine", { reason: v.reason })}</p>}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CaseControls({ caseId, status, priority, assigneeId, followUp, staff }: { caseId: string; status: string; priority: string; assigneeId: string | null; followUp: string | null; staff: PickerOption[] }) {
  const t = useTranslations("caseForms");
  const ts = useTranslations("status");
  const { pending, run } = useRun();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("status")}</Label>
        <Select value={status} onValueChange={(v) => run(() => updateCaseAction({ caseId, status: v as never }), t("updated"))} disabled={pending}>
          <SelectTrigger className="w-full" data-testid="case-status">
            <SelectValue>{ts(`case.${status}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {["NEW", "OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"].map((s) => (
              <SelectItem key={s} value={s}>
                {ts(`case.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("priority")}</Label>
        <Select value={priority} onValueChange={(v) => run(() => updateCaseAction({ caseId, priority: v as never }), t("updated"))} disabled={pending}>
          <SelectTrigger className="w-full">
            <SelectValue>{ts(`priority.${priority}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((s) => (
              <SelectItem key={s} value={s}>
                {ts(`priority.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("assignee")}</Label>
        <PickerCombobox options={staff} value={assigneeId ?? ""} onChange={(v) => run(() => updateCaseAction({ caseId, assigneeId: v }), t("updated"))} disabled={pending} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("followUp")}</Label>
        <Input type="date" defaultValue={followUp ?? ""} disabled={pending} onBlur={(e) => e.target.value !== (followUp ?? "") && run(() => updateCaseAction({ caseId, nextFollowUpAt: e.target.value ? `${e.target.value}T09:00:00+04:00` : null }), t("updated"))} />
      </div>
    </div>
  );
}

export function ParentDecisionForm({ caseId, guardians }: { caseId: string; guardians: Array<{ id: string; name: string }> }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [decision, setDecision] = useState<"NOTIFY" | "DO_NOT_NOTIFY" | "DEFER">("DEFER");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>(guardians.slice(0, 1).map((g) => g.id));
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {(["NOTIFY", "DEFER", "DO_NOT_NOTIFY"] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDecision(d)} className={cn("rounded-lg border px-2 py-2 text-xs font-medium", decision === d ? "border-brand bg-brand-soft text-brand ring-1 ring-brand/30" : "hover:bg-muted")}>
            {t(`decision.${d}`)}
          </button>
        ))}
      </div>
      {decision === "NOTIFY" && (
        <div className="space-y-2">
          {guardians.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.includes(g.id)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, g.id] : s.filter((x) => x !== g.id)))} />
              {g.name}
            </label>
          ))}
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={t("parentMessage")} />
        </div>
      )}
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t("decisionReason")} data-testid="decision-reason" />
      <Button size="sm" disabled={pending || !reason.trim()} onClick={() => run(() => recordParentDecisionAction({ caseId, decision, reason, guardianIds: decision === "NOTIFY" ? selected : [], message }), t("decisionRecorded"), () => setReason(""))} data-testid="record-decision">
        {t("recordDecision")}
      </Button>
    </div>
  );
}

export function ExternalReferralForm({ caseId }: { caseId: string }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ agencyEn: "", referredAt: new Date().toISOString().slice(0, 10), referenceNo: "", contactName: "", contactPhone: "", contactEmail: "", notes: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {t("addReferral")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("referralTitle")}</DialogTitle>
            <DialogDescription>{t("referralHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("agency")}</Label>
              <Input value={f.agencyEn} onChange={set("agencyEn")} placeholder={t("agencyPlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("referredOn")}</Label>
              <Input type="date" value={f.referredAt} onChange={set("referredAt")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("referenceNo")}</Label>
              <Input value={f.referenceNo} onChange={set("referenceNo")} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("contactName")}</Label>
              <Input value={f.contactName} onChange={set("contactName")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("contactPhone")}</Label>
              <Input value={f.contactPhone} onChange={set("contactPhone")} dir="ltr" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("notes")}</Label>
              <Textarea value={f.notes} onChange={set("notes")} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={pending || !f.agencyEn.trim()} onClick={() => run(() => addExternalReferralAction({ caseId, ...f }), t("referralAdded"), () => setOpen(false))}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GrantAccessForm({ caseId, staff }: { caseId: string; staff: PickerOption[] }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [who, setWho] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(30);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="text-sm font-medium">{t("grantTitle")}</div>
      <PickerCombobox options={staff} value={who} onChange={setWho} placeholder={t("grantWho")} />
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("grantReason")} />
      <div className="flex items-center gap-2">
        <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-24" />
        <span className="text-sm text-muted-foreground">{t("days")}</span>
        <Button size="sm" className="ms-auto" disabled={pending || !who || !reason.trim()} onClick={() => run(() => grantAccessAction({ caseId, membershipId: who, reason, days }), t("granted"), () => { setWho(""); setReason(""); })}>
          {t("grant")}
        </Button>
      </div>
    </div>
  );
}

export function RevokeButton({ grantId }: { grantId: string }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  return (
    <Button variant="ghost" size="sm" className="h-7 text-xs text-danger" disabled={pending} onClick={() => run(() => revokeAccessAction({ grantId }), t("revoked"))}>
      {t("revoke")}
    </Button>
  );
}

export function MessageComposer({ caseId, guardians, emailBlockedReason }: { caseId: string; guardians: Array<{ id: string; name: string }>; emailBlockedReason: string | null }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [channel, setChannel] = useState<"INTERNAL" | "EMAIL">("INTERNAL");
  const [to, setTo] = useState(guardians[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const emailDisabled = Boolean(emailBlockedReason) || guardians.length === 0;
  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setChannel("INTERNAL")} className={cn("rounded-full border px-3 py-1 text-xs font-medium", channel === "INTERNAL" ? "border-brand bg-brand text-brand-foreground" : "bg-card")}>
          {t("internal")}
        </button>
        {emailDisabled ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-not-allowed rounded-full border bg-card px-3 py-1 text-xs font-medium opacity-50">{t("emailFamily")}</span>
            </TooltipTrigger>
            <TooltipContent>{emailBlockedReason ?? t("noGuardians")}</TooltipContent>
          </Tooltip>
        ) : (
          <button type="button" onClick={() => setChannel("EMAIL")} className={cn("rounded-full border px-3 py-1 text-xs font-medium", channel === "EMAIL" ? "border-brand bg-brand text-brand-foreground" : "bg-card")}>
            {t("emailFamily")}
          </button>
        )}
      </div>
      {channel === "EMAIL" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger className="w-full">
              <SelectValue>{guardians.find((g) => g.id === to)?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {guardians.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("subject")} />
        </div>
      )}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={channel === "EMAIL" ? t("emailPlaceholder") : t("internalPlaceholder")} />
      <div className="flex justify-end">
        <Button size="sm" disabled={pending || !body.trim()} onClick={() => run(() => sendCaseMessageAction({ caseId, channel, toGuardianId: channel === "EMAIL" ? to : null, subject, body }), t("sent"), () => setBody(""))}>
          <Send className="size-4 rtl:-scale-x-100" />
          {t("send")}
        </Button>
      </div>
    </div>
  );
}

export function AddTaskForm({ caseId, studentId, staff, meId }: { caseId: string; studentId: string; staff: PickerOption[]; meId: string }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState(meId);
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[1fr_160px_200px_auto]">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("taskTitle")} />
      <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <PickerCombobox options={staff} value={who} onChange={setWho} />
      <Button disabled={pending || !title.trim()} onClick={() => run(() => createTaskAction({ titleEn: title, dueAt: due ? `${due}T15:00:00+04:00` : null, assigneeId: who, caseId, studentId }), t("taskAdded"), () => setTitle(""))}>
        <Plus className="size-4" />
        {t("addTask")}
      </Button>
    </div>
  );
}

export function BreakGlassForm({ caseId }: { caseId: string }) {
  const t = useTranslations("caseForms");
  const { pending, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("breakGlassReason")} data-testid="break-glass-reason" />
      <Button variant="destructive" disabled={pending || reason.trim().length < 10} onClick={() => run(() => breakGlassAction({ caseId, reason }), t("breakGlassDone"))} data-testid="break-glass">
        <ShieldAlert className="size-4" />
        {t("breakGlass")}
      </Button>
    </div>
  );
}
