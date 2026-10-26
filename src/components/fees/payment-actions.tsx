"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CircleCheck, Loader2, Play, RotateCcw, Square, X } from "lucide-react";
import type { FeePaymentMethod } from "@prisma/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bounceChequeAction, cancelBillingRunAction, clearChequeAction, decideAwardAction, decideRefundAction, markRefundPaidAction, startBillingRunAction } from "@/server/fees/actions";
import { Field, todayInput, useFeeError } from "./form-bits";

function useAction() {
  const err = useFeeError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, go };
}

export function ClearChequeDialog({ paymentId, chequeDate }: { paymentId: string; chequeDate: string }) {
  const t = useTranslations("finance.cheque");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(chequeDate > todayInput() ? todayInput() : chequeDate);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`clear-${paymentId}`}>
        <CircleCheck className="size-4" />
        {t("clear")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("clear")}</DialogTitle>
            <DialogDescription>{t("clearBody")}</DialogDescription>
          </DialogHeader>
          <Field label={t("clearedOn")} htmlFor="cq-on">
            <Input id="cq-on" type="date" value={on} max={todayInput()} onChange={(e) => setOn(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => clearChequeAction(paymentId, on), t("cleared"), () => setOpen(false))} disabled={pending} data-testid="cq-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("clear")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BounceDialog({ paymentId }: { paymentId: string }) {
  const t = useTranslations("finance.cheque");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`bounce-${paymentId}`}>
        <RotateCcw className="size-4" />
        {t("bounce")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("bounce")}</DialogTitle>
            <DialogDescription>{t("bounceBody")}</DialogDescription>
          </DialogHeader>
          <Field label={t("reason")} htmlFor="bc-reason">
            <Input id="bc-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => go(() => bounceChequeAction(paymentId, reason), t("bounced"), () => setOpen(false))} disabled={pending || reason.trim().length < 3}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("bounce")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Approve or reject a refund or an award. The person who asked cannot decide (the server checks too). */
export function DecisionButtons({ kind, id, own }: { kind: "refund" | "award"; id: string; own: boolean }) {
  const t = useTranslations("finance.approvals");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");
  if (own) return <span className="text-xs text-muted-foreground">{t("ownRequest")}</span>;
  const act = (approve: boolean) => go(() => (kind === "refund" ? decideRefundAction(id, approve, note) : decideAwardAction(id, approve, note)), approve ? t("approved") : t("rejected"), () => setOpen(null));
  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setOpen("approve")} data-testid={`approve-${id}`}>
          <Check className="size-4" />
          {t("approve")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen("reject")} data-testid={`reject-${id}`}>
          <X className="size-4" />
          {t("reject")}
        </Button>
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{open === "approve" ? t("approve") : t("reject")}</DialogTitle>
            <DialogDescription>{t("noteBody")}</DialogDescription>
          </DialogHeader>
          <Field label={t("note")} htmlFor="dc-note">
            <Textarea id="dc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => act(open === "approve")} disabled={pending} variant={open === "reject" ? "destructive" : "default"} data-testid="decision-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {open === "approve" ? t("approve") : t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RefundPaidDialog({ refundId }: { refundId: string }) {
  const t = useTranslations("finance.refund");
  const tm = useTranslations("finance.method");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<FeePaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [on, setOn] = useState(todayInput());
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`refund-paid-${refundId}`}>
        {t("markPaid")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("markPaid")}</DialogTitle>
            <DialogDescription>{t("markPaidBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("method")}>
              <Select value={method} onValueChange={(v) => setMethod(v as FeePaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["BANK_TRANSFER", "CHEQUE", "CASH", "CARD"] as const).map((m) => (
                    <SelectItem key={m} value={m}>
                      {tm(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("reference")} htmlFor="rp-ref">
              <Input id="rp-ref" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label={t("paidOn")} htmlFor="rp-on">
              <Input id="rp-on" type="date" value={on} max={todayInput()} onChange={(e) => setOn(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => markRefundPaidAction({ refundId, method, reference, paidOn: on }), t("paid"), () => setOpen(false))} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("markPaid")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Billing runs
// ---------------------------------------------------------------------------------------------

export function NewRunDialog({ parts, blocked }: { parts: Array<{ id: string; label: string; due: string; families: number; billed: boolean }>; blocked: string | null }) {
  const t = useTranslations("finance.billing");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const firstOpen = parts.find((p) => !p.billed) ?? parts[0];
  const [open, setOpen] = useState(false);
  const [partId, setPartId] = useState(firstOpen?.id ?? "");
  const part = parts.find((p) => p.id === partId);
  const [issue, setIssue] = useState(todayInput());
  const [due, setDue] = useState(firstOpen ? (firstOpen.due < todayInput() ? todayInput() : firstOpen.due) : todayInput());
  const [charges, setCharges] = useState(true);
  if (blocked || !parts.length) {
    return (
      <Button disabled title={blocked ?? t("noPlans")} data-testid="new-run-disabled">
        <Play className="size-4" />
        {t("newRun")}
      </Button>
    );
  }
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-run">
        <Play className="size-4" />
        {t("newRun")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newRun")}</DialogTitle>
            <DialogDescription>{t("newRunBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("instalment")}>
              <Select
                value={partId}
                onValueChange={(v) => {
                  setPartId(v);
                  const p = parts.find((x) => x.id === v);
                  if (p) setDue(p.due < todayInput() ? todayInput() : p.due);
                }}
              >
                <SelectTrigger data-testid="run-part">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                      {p.billed ? ` · ${t("alreadyRun")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {part && <p className="text-xs text-muted-foreground">{t("families", { n: part.families })}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("issueDate")} htmlFor="run-issue">
                <Input id="run-issue" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} />
              </Field>
              <Field label={t("dueDate")} htmlFor="run-due">
                <Input id="run-due" type="date" value={due} min={issue} onChange={(e) => setDue(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={charges} onCheckedChange={(v) => setCharges(v === true)} />
              {t("includeCharges")}
            </label>
            {part?.billed && <p className="rounded-md bg-warning-soft p-2 text-xs">{t("rerunNote")}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => startBillingRunAction({ partId, issueDate: issue, dueDate: due, includeCharges: charges }), t("started"), () => setOpen(false))} disabled={pending || !partId} data-testid="run-start">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** While a run is in progress, refresh the page every two seconds to show progress. */
export function RunAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(h);
  }, [active, router]);
  return null;
}

export function CancelRunButton({ runId }: { runId: string }) {
  const t = useTranslations("finance.billing");
  const { pending, go } = useAction();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(() => cancelBillingRunAction(runId), t("cancelled"))}>
      <Square className="size-3.5" />
      {t("cancel")}
    </Button>
  );
}
