"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Bell, Banknote, CircleDollarSign, FileMinus, Loader2, LogOut, Plus, Receipt, Settings2, Sparkles, Trash2, Undo2, UserCog } from "lucide-react";
import type { FeePayerType, FeePaymentMethod } from "@prisma/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  addChargeAction,
  applyCreditAction,
  billFamilyAction,
  cancelProformaAction,
  issueCreditNoteAction,
  leaverCreditAction,
  recordPaymentAction,
  removeChargeAction,
  requestAwardAction,
  requestRefundAction,
  revokeAwardAction,
  sendReminderAction,
  setStudentProfileAction,
  updateAccountAction,
} from "@/server/fees/actions";
import { formatAed } from "@/server/fees/money";
import { AmountInput, Field, filsToInput, newKey, parseAed, todayInput, ToggleRow, useFeeError } from "./form-bits";

type Opt = { value: string; label: string };

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

// ---------------------------------------------------------------------------------------------
// Record a payment (cash, cheque including post-dated, bank transfer, card terminal)
// ---------------------------------------------------------------------------------------------

export function RecordPaymentDialog({
  accountId,
  invoices,
  defaultInvoiceId,
  early,
  locale,
  label,
}: {
  accountId: string;
  invoices: Array<{ id: string; number: string; balanceFils: number }>;
  defaultInvoiceId?: string | null;
  early?: { invoiceId: string; discountFils: number; payNowFils: number; deadline: string } | null;
  locale: "en" | "ar";
  label?: string;
}) {
  const t = useTranslations("finance.pay");
  const tm = useTranslations("finance.method");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(newKey);
  const [method, setMethod] = useState<FeePaymentMethod>("BANK_TRANSFER");
  const [invoiceId, setInvoiceId] = useState<string>(defaultInvoiceId ?? "auto");
  const target = invoices.find((i) => i.id === invoiceId);
  const [amount, setAmount] = useState(filsToInput(target?.balanceFils ?? invoices[0]?.balanceFils ?? null));
  const [receivedOn, setReceivedOn] = useState(todayInput());
  const [reference, setReference] = useState("");
  const [cheque, setCheque] = useState({ number: "", bank: "", date: todayInput() });
  const [payer, setPayer] = useState("");
  const [notes, setNotes] = useState("");
  const [takeEarly, setTakeEarly] = useState(false);
  const fils = parseAed(amount);
  const earlyHere = early && early.invoiceId === invoiceId ? early : null;
  const postDated = method === "CHEQUE" && cheque.date > receivedOn;
  const valid = fils !== null && fils > 0 && (method !== "BANK_TRANSFER" || reference.trim()) && (method !== "CHEQUE" || (cheque.number.trim() && cheque.bank.trim() && cheque.date));
  const reset = () => {
    setKey(newKey());
    setReference("");
    setCheque({ number: "", bank: "", date: todayInput() });
    setNotes("");
    setPayer("");
    setTakeEarly(false);
  };
  const submit = () =>
    go(
      () =>
        recordPaymentAction({
          accountId,
          method,
          amountFils: fils ?? 0,
          receivedOn,
          reference,
          chequeNumber: cheque.number,
          chequeBank: cheque.bank,
          chequeDate: method === "CHEQUE" ? cheque.date : "",
          payerName: payer,
          notes,
          idempotencyKey: key,
          invoiceId: invoiceId === "auto" ? null : invoiceId,
          takeEarlyDiscount: Boolean(earlyHere && takeEarly),
        }),
      postDated ? t("heldSaved") : t("saved"),
      () => {
        setOpen(false);
        reset();
      },
    );
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="record-payment">
        <Banknote className="size-4" />
        {label ?? t("record")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("record")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("method")} htmlFor="pm-method">
              <Select value={method} onValueChange={(v) => setMethod(v as FeePaymentMethod)}>
                <SelectTrigger id="pm-method" data-testid="pm-method">
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
            <Field label={t("applyTo")} htmlFor="pm-inv">
              <Select
                value={invoiceId}
                onValueChange={(v) => {
                  setInvoiceId(v);
                  const i = invoices.find((x) => x.id === v);
                  if (i) setAmount(filsToInput(i.balanceFils));
                }}
              >
                <SelectTrigger id="pm-inv" data-testid="pm-invoice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("oldestFirst")}</SelectItem>
                  {invoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.number} ({formatAed(i.balanceFils, locale)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("amount")} htmlFor="pm-amount" hint={t("amountHint")}>
              <AmountInput id="pm-amount" value={amount} onChange={setAmount} testId="pm-amount" />
            </Field>
            <Field label={t("receivedOn")} htmlFor="pm-date">
              <Input id="pm-date" type="date" value={receivedOn} max={todayInput()} onChange={(e) => setReceivedOn(e.target.value)} />
            </Field>
            {method === "BANK_TRANSFER" && (
              <Field label={t("reference")} htmlFor="pm-ref" className="sm:col-span-2" hint={t("referenceHint")}>
                <Input id="pm-ref" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="pm-reference" />
              </Field>
            )}
            {method === "CARD" && (
              <Field label={t("cardRef")} htmlFor="pm-card" className="sm:col-span-2">
                <Input id="pm-card" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            )}
            {method === "CHEQUE" && (
              <>
                <Field label={t("chequeNumber")} htmlFor="pm-cq-no">
                  <Input id="pm-cq-no" dir="ltr" value={cheque.number} onChange={(e) => setCheque((c) => ({ ...c, number: e.target.value }))} data-testid="pm-cheque-no" />
                </Field>
                <Field label={t("chequeBank")} htmlFor="pm-cq-bank">
                  <Input id="pm-cq-bank" value={cheque.bank} onChange={(e) => setCheque((c) => ({ ...c, bank: e.target.value }))} data-testid="pm-cheque-bank" />
                </Field>
                <Field label={t("chequeDate")} htmlFor="pm-cq-date" className="sm:col-span-2" hint={postDated ? t("postDatedHint") : t("chequeDateHint")}>
                  <Input id="pm-cq-date" type="date" value={cheque.date} onChange={(e) => setCheque((c) => ({ ...c, date: e.target.value }))} data-testid="pm-cheque-date" />
                </Field>
              </>
            )}
            <Field label={t("payerName")} htmlFor="pm-payer" hint={t("payerNameHint")}>
              <Input id="pm-payer" value={payer} onChange={(e) => setPayer(e.target.value)} />
            </Field>
            <Field label={t("notes")} htmlFor="pm-notes">
              <Input id="pm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {earlyHere && (
              <label className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft/40 p-3 text-sm sm:col-span-2">
                <Checkbox
                  checked={takeEarly}
                  onCheckedChange={(v) => {
                    setTakeEarly(v === true);
                    if (v === true) setAmount(filsToInput(earlyHere.payNowFils));
                  }}
                  data-testid="pm-early"
                />
                <span>{t("earlyOffer", { discount: formatAed(earlyHere.discountFils, locale), pay: formatAed(earlyHere.payNowFils, locale), date: earlyHere.deadline })}</span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={!valid || pending} data-testid="pm-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {postDated ? t("saveHeld") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Credit note (never edit an issued invoice)
// ---------------------------------------------------------------------------------------------

export function CreditNoteDialog({ invoiceId, lines, locale }: { invoiceId: string; lines: Array<{ id: string; description: string; netLeft: number; vatRateBp: number }>; locale: "en" | "ar" }) {
  const t = useTranslations("finance.credit");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [reasonKind, setReasonKind] = useState<"CORRECTION" | "DISCOUNT" | "CANCELLATION">("CORRECTION");
  const [reasonEn, setReasonEn] = useState("");
  const [reasonAr, setReasonAr] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const creditable = lines.filter((l) => l.netLeft > 0);
  const parsed = creditable.map((l) => ({ id: l.id, fils: amounts[l.id]?.trim() ? parseAed(amounts[l.id]) : 0, max: l.netLeft }));
  const valid = reasonEn.trim().length > 2 && parsed.every((p) => p.fils !== null && p.fils <= p.max) && parsed.some((p) => (p.fils ?? 0) > 0);
  const fillAll = () => setAmounts(Object.fromEntries(creditable.map((l) => [l.id, filsToInput(l.netLeft)])));
  if (!creditable.length) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="credit-note">
        <FileMinus className="size-4" />
        {t("issue")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("issue")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("reasonKind")} htmlFor="cn-kind">
              <Select value={reasonKind} onValueChange={(v) => setReasonKind(v as typeof reasonKind)}>
                <SelectTrigger id="cn-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["CORRECTION", "DISCOUNT", "CANCELLATION"] as const).map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={fillAll} data-testid="cn-all">
                {t("creditAll")}
              </Button>
            </div>
            <Field label={t("reasonEn")} htmlFor="cn-r-en">
              <Input id="cn-r-en" dir="ltr" value={reasonEn} onChange={(e) => setReasonEn(e.target.value)} data-testid="cn-reason" />
            </Field>
            <Field label={t("reasonAr")} htmlFor="cn-r-ar">
              <Input id="cn-r-ar" dir="rtl" value={reasonAr} onChange={(e) => setReasonAr(e.target.value)} />
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("linesHint")}</p>
            {creditable.map((l) => (
              <div key={l.id} className="grid items-center gap-2 rounded-lg border p-3 sm:grid-cols-5">
                <div className="min-w-0 text-sm sm:col-span-3">
                  <div className="truncate font-medium">{l.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("upTo", { amount: formatAed(l.netLeft, locale) })}
                    {l.vatRateBp ? ` · ${t("plusVat", { pct: l.vatRateBp / 100 })}` : ""}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <AmountInput id={`cn-${l.id}`} value={amounts[l.id] ?? ""} onChange={(v) => setAmounts((a) => ({ ...a, [l.id]: v }))} testId={`cn-line-${l.id}`} />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={() =>
                go(
                  () => issueCreditNoteAction({ invoiceId, reasonKind, reasonEn, reasonAr, lines: parsed.filter((p) => (p.fils ?? 0) > 0).map((p) => ({ invoiceLineId: p.id, netFils: p.fils! })) }),
                  t("issued"),
                  () => setOpen(false),
                )
              }
              disabled={!valid || pending}
              data-testid="cn-save"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("issue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// One-off charges, billing one family, leaver credit
// ---------------------------------------------------------------------------------------------

export function AddChargeDialog({ accountId, items, students }: { accountId: string; items: Array<{ id: string; label: string; amountFils: number }>; students: Opt[] }) {
  const t = useTranslations("finance.charge");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [studentId, setStudentId] = useState(students[0]?.value ?? "none");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState(filsToInput(items[0]?.amountFils));
  const [descEn, setDescEn] = useState("");
  const [descAr, setDescAr] = useState("");
  const [now, setNow] = useState(true);
  const fils = parseAed(unit);
  const q = Number(qty);
  const valid = itemId && fils !== null && fils > 0 && Number.isInteger(q) && q >= 1 && q <= 100;
  if (!items.length) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button variant="outline" disabled>
              <Plus className="size-4" />
              {t("add")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("noItems")}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="add-charge">
        <Plus className="size-4" />
        {t("add")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("item")} htmlFor="ch-item">
              <Select
                value={itemId}
                onValueChange={(v) => {
                  setItemId(v);
                  setUnit(filsToInput(items.find((i) => i.id === v)?.amountFils));
                }}
              >
                <SelectTrigger id="ch-item" data-testid="ch-item">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("student")} htmlFor="ch-student">
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger id="ch-student">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("wholeFamily")}</SelectItem>
                  {students.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("quantity")} htmlFor="ch-qty">
              <Input id="ch-qty" dir="ltr" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label={t("unit")} htmlFor="ch-unit">
              <AmountInput id="ch-unit" value={unit} onChange={setUnit} testId="ch-unit" />
            </Field>
            <Field label={t("descEn")} htmlFor="ch-d-en" hint={t("descHint")}>
              <Input id="ch-d-en" dir="ltr" value={descEn} onChange={(e) => setDescEn(e.target.value)} />
            </Field>
            <Field label={t("descAr")} htmlFor="ch-d-ar">
              <Input id="ch-d-ar" dir="rtl" value={descAr} onChange={(e) => setDescAr(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <ToggleRow id="ch-now" label={t("invoiceNow")} hint={t("invoiceNowHint")} checked={now} onChange={setNow} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={() =>
                go(
                  () => addChargeAction({ accountId, studentId: studentId === "none" ? null : studentId, feeItemId: itemId, quantity: q, unitFils: fils ?? 0, descriptionEn: descEn, descriptionAr: descAr, invoiceNow: now }),
                  now ? t("invoiced") : t("added"),
                  () => setOpen(false),
                )
              }
              disabled={!valid || pending}
              data-testid="ch-save"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {now ? t("invoiceNowButton") : t("addButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemoveChargeButton({ id }: { id: string }) {
  const t = useTranslations("finance.charge");
  const { pending, go } = useAction();
  return (
    <Button variant="ghost" size="icon" aria-label={t("remove")} disabled={pending} onClick={() => go(() => removeChargeAction(id), t("removed"))}>
      <Trash2 className="size-4" />
    </Button>
  );
}

export function BillFamilyDialog({ accountId, parts }: { accountId: string; parts: Array<{ id: string; label: string; due: string }> }) {
  const t = useTranslations("finance.billFamily");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [partId, setPartId] = useState(parts[0]?.id ?? "");
  const [due, setDue] = useState(parts[0]?.due ?? todayInput());
  if (!parts.length) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="bill-family">
        <Receipt className="size-4" />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
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
                <SelectTrigger data-testid="bf-part">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("due")} htmlFor="bf-due">
              <Input id="bf-due" type="date" value={due} min={todayInput()} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => billFamilyAction({ accountId, partId, dueDate: due }), t("done"), () => setOpen(false))} disabled={pending || !partId} data-testid="bf-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("issue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LeaverDialog({ students }: { students: Opt[] }) {
  const t = useTranslations("finance.leaver");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.value ?? "");
  const [leftOn, setLeftOn] = useState(todayInput());
  if (!students.length) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="leaver-credit">
        <LogOut className="size-4 rtl:rotate-180" />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("student")}>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("leftOn")} htmlFor="lv-date">
              <Input id="lv-date" type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => leaverCreditAction({ studentId, leftOn }), t("done"), () => setOpen(false))} disabled={pending || !studentId}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("issue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Credit, refunds, reminders, proformas
// ---------------------------------------------------------------------------------------------

export function ApplyCreditButton({ accountId }: { accountId: string }) {
  const t = useTranslations("finance.account");
  const { pending, go } = useAction();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => go(() => applyCreditAction(accountId), t("creditApplied"))} data-testid="apply-credit">
      <Sparkles className="size-4" />
      {t("applyCredit")}
    </Button>
  );
}

export function RefundDialog({ payments, locale }: { payments: Array<{ id: string; label: string; availableFils: number }>; locale: "en" | "ar" }) {
  const t = useTranslations("finance.refund");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? "");
  const p = payments.find((x) => x.id === paymentId);
  const [amount, setAmount] = useState(filsToInput(payments[0]?.availableFils));
  const [reason, setReason] = useState("");
  const fils = parseAed(amount);
  const valid = p && fils !== null && fils > 0 && fils <= p.availableFils && reason.trim().length > 2;
  if (!payments.length) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="request-refund">
        <Undo2 className="size-4" />
        {t("request")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("request")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("from")}>
              <Select
                value={paymentId}
                onValueChange={(v) => {
                  setPaymentId(v);
                  setAmount(filsToInput(payments.find((x) => x.id === v)?.availableFils));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {payments.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.label} ({formatAed(x.availableFils, locale)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("amount")} htmlFor="rf-amount">
              <AmountInput id="rf-amount" value={amount} onChange={setAmount} testId="rf-amount" />
            </Field>
            <Field label={t("reason")} htmlFor="rf-reason">
              <Textarea id="rf-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rf-reason" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => requestRefundAction({ paymentId, amountFils: fils ?? 0, reason }), t("requested"), () => setOpen(false))} disabled={!valid || pending} data-testid="rf-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReminderButton({ invoiceId, disabledReason }: { invoiceId: string; disabledReason?: string | null }) {
  const t = useTranslations("finance.invoice");
  const { pending, go } = useAction();
  if (disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button variant="outline" disabled>
              <Bell className="size-4" />
              {t("remind")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button variant="outline" disabled={pending} onClick={() => go(() => sendReminderAction(invoiceId), t("reminded"))} data-testid="send-reminder">
      <Bell className="size-4" />
      {t("remind")}
    </Button>
  );
}

export function CancelProformaButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("finance.invoice");
  const { pending, go } = useAction();
  return (
    <Button variant="outline" disabled={pending} onClick={() => window.confirm(t("cancelProformaConfirm")) && go(() => cancelProformaAction(invoiceId), t("proformaCancelled"))}>
      <Ban className="size-4" />
      {t("cancelProforma")}
    </Button>
  );
}

// ---------------------------------------------------------------------------------------------
// Account settings, children, awards
// ---------------------------------------------------------------------------------------------

export type AccountEdit = {
  id: string;
  nameEn: string;
  nameAr: string;
  payerType: FeePayerType;
  payerGuardianId: string | null;
  sponsorName: string;
  sponsorTrn: string;
  billingAddress: string;
  billingEmail: string;
  planKey: string;
  remindersPaused: boolean;
  pausedReason: string;
};

export function AccountEditDialog({ initial, guardians, plans }: { initial: AccountEdit; guardians: Opt[]; plans: Opt[] }) {
  const t = useTranslations("finance.account");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  const set = <K extends keyof AccountEdit>(k: K, v: AccountEdit[K]) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.nameEn.trim() && f.nameAr.trim() && (f.payerType !== "SPONSOR" || f.sponsorName.trim()) && (!f.remindersPaused || f.pausedReason.trim());
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => (setF(initial), setOpen(true))} data-testid="edit-account">
        <Settings2 className="size-4" />
        {t("edit")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("edit")}</DialogTitle>
            <DialogDescription>{t("editBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("nameEn")} htmlFor="ac-n-en">
              <Input id="ac-n-en" dir="ltr" value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
            </Field>
            <Field label={t("nameAr")} htmlFor="ac-n-ar">
              <Input id="ac-n-ar" dir="rtl" value={f.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
            </Field>
            <Field label={t("payerType")} htmlFor="ac-pt">
              <Select value={f.payerType} onValueChange={(v) => set("payerType", v as FeePayerType)}>
                <SelectTrigger id="ac-pt" data-testid="ac-payer-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GUARDIAN">{t("payerGuardian")}</SelectItem>
                  <SelectItem value="SPONSOR">{t("payerSponsor")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {f.payerType === "GUARDIAN" ? (
              <Field label={t("payer")} htmlFor="ac-g">
                <Select value={f.payerGuardianId ?? "none"} onValueChange={(v) => set("payerGuardianId", v === "none" ? null : v)}>
                  <SelectTrigger id="ac-g">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("noPayer")}</SelectItem>
                    {guardians.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <>
                <Field label={t("sponsorName")} htmlFor="ac-sn">
                  <Input id="ac-sn" value={f.sponsorName} onChange={(e) => set("sponsorName", e.target.value)} data-testid="ac-sponsor" />
                </Field>
                <Field label={t("sponsorTrn")} htmlFor="ac-st" hint={t("sponsorTrnHint")}>
                  <Input id="ac-st" dir="ltr" inputMode="numeric" value={f.sponsorTrn} onChange={(e) => set("sponsorTrn", e.target.value.replace(/\D/g, "").slice(0, 15))} />
                </Field>
              </>
            )}
            <Field label={t("billingEmail")} htmlFor="ac-em">
              <Input id="ac-em" dir="ltr" type="email" value={f.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} />
            </Field>
            <Field label={t("plan")} htmlFor="ac-plan">
              <Select value={f.planKey || "default"} onValueChange={(v) => set("planKey", v === "default" ? "" : v)}>
                <SelectTrigger id="ac-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t("defaultPlan")}</SelectItem>
                  {plans.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("billingAddress")} htmlFor="ac-ad" className="sm:col-span-2">
              <Textarea id="ac-ad" rows={2} value={f.billingAddress} onChange={(e) => set("billingAddress", e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <ToggleRow id="ac-pause" label={t("pauseReminders")} hint={t("pauseRemindersHint")} checked={f.remindersPaused} onChange={(v) => set("remindersPaused", v)} />
            </div>
            {f.remindersPaused && (
              <Field label={t("pausedReason")} htmlFor="ac-pr" className="sm:col-span-2">
                <Input id="ac-pr" value={f.pausedReason} onChange={(e) => set("pausedReason", e.target.value)} />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={() =>
                go(
                  () =>
                    updateAccountAction(f.id, {
                      nameEn: f.nameEn,
                      nameAr: f.nameAr,
                      payerType: f.payerType,
                      payerGuardianId: f.payerGuardianId,
                      sponsorName: f.sponsorName || null,
                      sponsorTrn: f.sponsorTrn || null,
                      billingAddress: f.billingAddress || null,
                      billingEmail: f.billingEmail || null,
                      planKey: f.planKey || null,
                      remindersPaused: f.remindersPaused,
                      pausedReason: f.pausedReason || null,
                    }),
                  t("saved"),
                  () => setOpen(false),
                )
              }
              disabled={!valid || pending}
              data-testid="ac-save"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function StudentProfileDialog({ studentId, studentName, accountId, transportZone, accounts, zones }: { studentId: string; studentName: string; accountId: string; transportZone: string | null; accounts: Opt[]; zones: Opt[] }) {
  const t = useTranslations("finance.account");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [acc, setAcc] = useState(accountId);
  const [zone, setZone] = useState(transportZone ?? "none");
  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label={t("childSettings")} data-testid={`child-settings-${studentId}`}>
        <UserCog className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{studentName}</DialogTitle>
            <DialogDescription>{t("childSettingsBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("transportZone")}>
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger data-testid="child-zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("noTransport")}</SelectItem>
                  {zones.map((z) => (
                    <SelectItem key={z.value} value={z.value}>
                      {z.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("billedTo")} hint={t("billedToHint")}>
              <Select value={acc} onValueChange={setAcc}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => setStudentProfileAction({ studentId, accountId: acc, transportZone: zone === "none" ? null : zone }), t("saved"), () => setOpen(false))} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AwardDialog({ students, discounts, yearId }: { students: Opt[]; discounts: Array<Opt & { approval: boolean }>; yearId: string }) {
  const t = useTranslations("finance.award");
  const tc = useTranslations("common");
  const { pending, go } = useAction();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.value ?? "");
  const [discountId, setDiscountId] = useState(discounts[0]?.value ?? "");
  const [reason, setReason] = useState("");
  const needs = useMemo(() => discounts.find((d) => d.value === discountId)?.approval ?? true, [discounts, discountId]);
  if (!students.length) return null;
  if (!discounts.length) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button variant="outline" size="sm" disabled>
              <CircleDollarSign className="size-4" />
              {t("add")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("noDiscounts")}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="add-award">
        <CircleDollarSign className="size-4" />
        {t("add")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{needs ? t("bodyApproval") : t("body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("student")}>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("discount")}>
              <Select value={discountId} onValueChange={setDiscountId}>
                <SelectTrigger data-testid="aw-discount">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {discounts.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("reason")} htmlFor="aw-reason">
              <Textarea id="aw-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="aw-reason" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => go(() => requestAwardAction({ studentId, discountId, academicYearId: yearId, reason }), needs ? t("sent") : t("granted"), () => setOpen(false))} disabled={pending || reason.trim().length < 3} data-testid="aw-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {needs ? t("sendForApproval") : t("grant")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RevokeAwardButton({ id }: { id: string }) {
  const t = useTranslations("finance.award");
  const { pending, go } = useAction();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => go(() => revokeAwardAction(id), t("revoked"))}>
      <Ban className="size-3.5" />
      {t("revoke")}
    </Button>
  );
}
