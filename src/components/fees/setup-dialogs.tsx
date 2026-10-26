"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2, Pencil, Plus, RefreshCw, Trash2, Wand2 } from "lucide-react";
import type { DiscountMethod, FeeDiscountKind, FeeItemKind, InstalmentPlanKind, VatTreatment } from "@prisma/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copyScheduleAction, deleteFeeItemAction, saveDiscountAction, saveFeeItemAction, savePlanAction, suggestPartsAction, syncAccountsAction, type DiscountForm, type FeeItemForm, type PlanForm } from "@/server/fees/actions";
import { AmountInput, bpToInput, Field, filsToInput, GradeChips, parseAed, parsePercent, ToggleRow, useFeeError } from "./form-bits";

const KINDS: FeeItemKind[] = ["TUITION", "TRANSPORT", "REGISTRATION", "REENROLLMENT", "SEAT_DEPOSIT", "BOOKS", "UNIFORM", "TRIP", "EXAM", "OTHER"];
const VAT: VatTreatment[] = ["ZERO_RATED", "STANDARD", "EXEMPT", "OUT_OF_SCOPE"];
const DEFAULT_VAT: Record<FeeItemKind, VatTreatment> = { TUITION: "ZERO_RATED", REGISTRATION: "ZERO_RATED", REENROLLMENT: "ZERO_RATED", SEAT_DEPOSIT: "ZERO_RATED", BOOKS: "ZERO_RATED", TRANSPORT: "STANDARD", UNIFORM: "STANDARD", TRIP: "STANDARD", EXAM: "STANDARD", OTHER: "STANDARD" };
const RECURRING = new Set<FeeItemKind>(["TUITION", "TRANSPORT"]);

export function FeeItemDialog({ yearId, initial }: { yearId: string; initial?: FeeItemForm }) {
  const t = useTranslations("finance.setup");
  const tk = useTranslations("finance.kind");
  const tv = useTranslations("finance.vat");
  const tc = useTranslations("common");
  const err = useFeeError();
  const router = useRouter();
  const blank: FeeItemForm = { id: null, academicYearId: yearId, code: "", kind: "TUITION", nameEn: "", nameAr: "", amountFils: 0, gradeLevels: [], zone: "", recurring: true, proRata: true, discountable: true, autoBill: true, vatTreatment: "ZERO_RATED", active: true };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FeeItemForm>(initial ?? blank);
  const [amount, setAmount] = useState(filsToInput(initial?.amountFils));
  const [pending, start] = useTransition();
  const set = <K extends keyof FeeItemForm>(k: K, v: FeeItemForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const setKind = (kind: FeeItemKind) =>
    setF((p) => ({ ...p, kind, vatTreatment: DEFAULT_VAT[kind], recurring: RECURRING.has(kind), proRata: RECURRING.has(kind), discountable: kind === "TUITION", autoBill: RECURRING.has(kind), gradeLevels: kind === "TUITION" ? p.gradeLevels.slice(0, 1) : p.gradeLevels }));
  const fils = parseAed(amount);
  const valid = f.code.trim() && f.nameEn.trim() && f.nameAr.trim() && fils !== null && (f.kind !== "TUITION" || f.gradeLevels.length === 1) && (f.kind !== "TRANSPORT" || f.zone.trim());
  const submit = () =>
    start(async () => {
      const res = await saveFeeItemAction({ ...f, amountFils: fils ?? 0 });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon" onClick={() => (setF(initial), setAmount(filsToInput(initial.amountFils)), setOpen(true))} aria-label={tc("edit")} data-testid={`edit-item-${initial.code}`}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button onClick={() => (setF(blank), setAmount(""), setOpen(true))} data-testid="new-fee-item">
          <Plus className="size-4" />
          {t("newItem")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("editItem") : t("newItem")}</DialogTitle>
            <DialogDescription>{t("itemDialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("kind")} htmlFor="fi-kind">
              <Select value={f.kind} onValueChange={(v) => setKind(v as FeeItemKind)}>
                <SelectTrigger id="fi-kind" data-testid="fi-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tk(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("code")} htmlFor="fi-code" hint={t("codeHint")}>
              <Input id="fi-code" dir="ltr" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} data-testid="fi-code" />
            </Field>
            <Field label={t("nameEn")} htmlFor="fi-name-en">
              <Input id="fi-name-en" dir="ltr" value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="fi-name-en" />
            </Field>
            <Field label={t("nameAr")} htmlFor="fi-name-ar">
              <Input id="fi-name-ar" dir="rtl" value={f.nameAr} onChange={(e) => set("nameAr", e.target.value)} data-testid="fi-name-ar" />
            </Field>
            <Field label={f.recurring ? t("annualAmount") : t("unitAmount")} htmlFor="fi-amount">
              <AmountInput id="fi-amount" value={amount} onChange={setAmount} testId="fi-amount" />
            </Field>
            <Field label={t("vatTreatment")} htmlFor="fi-vat" hint={t("vatHint")}>
              <Select value={f.vatTreatment} onValueChange={(v) => set("vatTreatment", v as VatTreatment)}>
                <SelectTrigger id="fi-vat" data-testid="fi-vat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VAT.map((v) => (
                    <SelectItem key={v} value={v}>
                      {tv(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {f.kind === "TRANSPORT" && (
              <Field label={t("zone")} htmlFor="fi-zone" hint={t("zoneHint")}>
                <Input id="fi-zone" dir="ltr" value={f.zone} onChange={(e) => set("zone", e.target.value.toUpperCase())} data-testid="fi-zone" />
              </Field>
            )}
            <Field label={f.kind === "TUITION" ? t("grade") : t("grades")} className="sm:col-span-2" hint={f.kind === "TUITION" ? t("gradeHint") : t("gradesHint")}>
              <GradeChips value={f.gradeLevels} onChange={(v) => set("gradeLevels", v)} single={f.kind === "TUITION"} testId="fi-grades" />
            </Field>
            <ToggleRow id="fi-recurring" label={t("recurring")} hint={t("recurringHint")} checked={f.recurring} onChange={(v) => setF((p) => ({ ...p, recurring: v, proRata: v && p.proRata }))} />
            <ToggleRow id="fi-prorata" label={t("proRata")} hint={t("proRataHint")} checked={f.proRata} onChange={(v) => set("proRata", v)} disabled={!f.recurring} />
            <ToggleRow id="fi-discountable" label={t("discountable")} hint={t("discountableHint")} checked={f.discountable} onChange={(v) => set("discountable", v)} />
            <ToggleRow id="fi-autobill" label={t("autoBill")} hint={t("autoBillHint")} checked={f.autoBill} onChange={(v) => set("autoBill", v)} />
            <ToggleRow id="fi-active" label={t("active")} checked={f.active} onChange={(v) => set("active", v)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={!valid || pending} data-testid="fi-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteItemButton({ id, code }: { id: string; code: string }) {
  const t = useTranslations("finance.setup");
  const err = useFeeError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("removeItem")}
      disabled={pending}
      data-testid={`delete-item-${code}`}
      onClick={() =>
        start(async () => {
          if (!window.confirm(t("removeItemConfirm"))) return;
          const res = await deleteFeeItemAction(id);
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(res.deleted ? t("itemRemoved") : t("itemSwitchedOff"));
          router.refresh();
        })
      }
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

const PLAN_KINDS: InstalmentPlanKind[] = ["TERMLY", "MONTHLY", "ANNUAL", "CUSTOM"];

export function PlanDialog({ yearId, initial, billed }: { yearId: string; initial?: PlanForm; billed?: boolean }) {
  const t = useTranslations("finance.setup");
  const tp = useTranslations("finance.planKind");
  const tc = useTranslations("common");
  const err = useFeeError();
  const router = useRouter();
  const blank: PlanForm = { id: null, academicYearId: yearId, key: "", nameEn: "", nameAr: "", kind: "TERMLY", isDefault: false, active: true, parts: [] };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<PlanForm>(initial ?? blank);
  const [shares, setShares] = useState<string[]>((initial?.parts ?? []).map((p) => bpToInput(p.shareBp)));
  const [pending, start] = useTransition();
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const setPart = (i: number, k: keyof PlanForm["parts"][number], v: string) => setF((p) => ({ ...p, parts: p.parts.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const bps = shares.map(parsePercent);
  const total = bps.reduce<number>((s, b) => s + (b ?? 0), 0);
  const valid = f.key.trim() && f.nameEn.trim() && f.nameAr.trim() && f.parts.length > 0 && bps.every((b) => b !== null) && total === 10_000;
  const suggest = (kind: InstalmentPlanKind) =>
    start(async () => {
      const res = await suggestPartsAction({ academicYearId: yearId, kind });
      if (!res.ok) return void toast.error(err(res.error));
      setF((p) => ({ ...p, kind, parts: res.parts }));
      setShares(res.parts.map((x) => bpToInput(x.shareBp)));
    });
  const submit = () =>
    start(async () => {
      const res = await savePlanAction({ ...f, parts: f.parts.map((p, i) => ({ ...p, shareBp: bps[i] ?? 0 })) });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      {initial ? (
        <Button variant="outline" size="sm" onClick={() => (setF(initial), setShares(initial.parts.map((p) => bpToInput(p.shareBp))), setOpen(true))} data-testid={`edit-plan-${initial.key}`}>
          <Pencil className="size-4" />
          {tc("edit")}
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setF(blank);
            setShares([]);
            setOpen(true);
            suggest("TERMLY");
          }}
          data-testid="new-plan"
        >
          <Plus className="size-4" />
          {t("newPlan")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("editPlan") : t("newPlan")}</DialogTitle>
            <DialogDescription>{billed ? t("planBilledBody") : t("planDialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("planKind")} htmlFor="plan-kind">
              <Select value={f.kind} onValueChange={(v) => (billed ? set("kind", v as InstalmentPlanKind) : suggest(v as InstalmentPlanKind))}>
                <SelectTrigger id="plan-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tp(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("planKey")} htmlFor="plan-key" hint={t("planKeyHint")}>
              <Input id="plan-key" dir="ltr" value={f.key} onChange={(e) => set("key", e.target.value.toLowerCase())} data-testid="plan-key" />
            </Field>
            <Field label={t("nameEn")} htmlFor="plan-name-en">
              <Input id="plan-name-en" dir="ltr" value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="plan-name-en" />
            </Field>
            <Field label={t("nameAr")} htmlFor="plan-name-ar">
              <Input id="plan-name-ar" dir="rtl" value={f.nameAr} onChange={(e) => set("nameAr", e.target.value)} data-testid="plan-name-ar" />
            </Field>
            <ToggleRow id="plan-default" label={t("planDefault")} hint={t("planDefaultHint")} checked={f.isDefault} onChange={(v) => set("isDefault", v)} />
            <ToggleRow id="plan-active" label={t("active")} checked={f.active} onChange={(v) => set("active", v)} />
          </div>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("instalments")}</h3>
              <span className={total === 10_000 ? "text-xs text-success" : "text-xs text-danger"} data-testid="plan-total">
                {t("sharesTotal", { pct: total / 100 })}
              </span>
            </div>
            {f.parts.map((p, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-6">
                <Input aria-label={t("nameEn")} dir="ltr" value={p.labelEn} onChange={(e) => setPart(i, "labelEn", e.target.value)} className="sm:col-span-2" />
                <Input aria-label={t("nameAr")} dir="rtl" value={p.labelAr} onChange={(e) => setPart(i, "labelAr", e.target.value)} className="sm:col-span-2" />
                <div className="relative sm:col-span-2">
                  <Input aria-label={t("share")} dir="ltr" inputMode="decimal" value={shares[i] ?? ""} onChange={(e) => setShares((s) => s.map((x, j) => (j === i ? e.target.value : x)))} className="pe-8" disabled={billed} />
                  <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">%</span>
                </div>
                <Field label={t("periodStart")} className="sm:col-span-2">
                  <Input type="date" value={p.periodStart} onChange={(e) => setPart(i, "periodStart", e.target.value)} disabled={billed} />
                </Field>
                <Field label={t("periodEnd")} className="sm:col-span-2">
                  <Input type="date" value={p.periodEnd} onChange={(e) => setPart(i, "periodEnd", e.target.value)} disabled={billed} />
                </Field>
                <Field label={t("dueDate")} className="sm:col-span-2">
                  <Input type="date" value={p.dueDate} onChange={(e) => setPart(i, "dueDate", e.target.value)} />
                </Field>
              </div>
            ))}
            {!f.parts.length && <p className="text-sm text-muted-foreground">{pending ? t("suggesting") : t("noParts")}</p>}
            {!billed && (
              <Button variant="ghost" size="sm" onClick={() => suggest(f.kind)} disabled={pending}>
                <Wand2 className="size-4" />
                {t("suggestAgain")}
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={!valid || pending} data-testid="plan-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const DISCOUNT_KINDS: FeeDiscountKind[] = ["STAFF_CHILD", "SCHOLARSHIP", "BURSARY", "OTHER"];

export function DiscountDialog({ initial }: { initial?: DiscountForm }) {
  const t = useTranslations("finance.setup");
  const td = useTranslations("finance.discountKind");
  const tc = useTranslations("common");
  const err = useFeeError();
  const router = useRouter();
  const blank: DiscountForm = { id: null, code: "", kind: "SCHOLARSHIP", nameEn: "", nameAr: "", method: "PERCENT", percentBp: null, amountFils: null, requiresApproval: true, active: true };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<DiscountForm>(initial ?? blank);
  const [pct, setPct] = useState(bpToInput(initial?.percentBp));
  const [amt, setAmt] = useState(filsToInput(initial?.amountFils));
  const [pending, start] = useTransition();
  const set = <K extends keyof DiscountForm>(k: K, v: DiscountForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const bp = parsePercent(pct);
  const fils = parseAed(amt);
  const forced = f.kind === "SCHOLARSHIP" || f.kind === "BURSARY";
  const valid = f.code.trim() && f.nameEn.trim() && f.nameAr.trim() && (f.method === "PERCENT" ? bp !== null && bp > 0 : fils !== null && fils > 0);
  const submit = () =>
    start(async () => {
      const res = await saveDiscountAction({ ...f, percentBp: f.method === "PERCENT" ? bp : null, amountFils: f.method === "FIXED" ? fils : null, requiresApproval: forced || f.requiresApproval });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon" onClick={() => (setF(initial), setPct(bpToInput(initial.percentBp)), setAmt(filsToInput(initial.amountFils)), setOpen(true))} aria-label={tc("edit")}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" onClick={() => (setF(blank), setPct(""), setAmt(""), setOpen(true))} data-testid="new-discount">
          <Plus className="size-4" />
          {t("newDiscount")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("editDiscount") : t("newDiscount")}</DialogTitle>
            <DialogDescription>{t("discountDialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("kind")} htmlFor="dc-kind">
              <Select value={f.kind} onValueChange={(v) => set("kind", v as FeeDiscountKind)}>
                <SelectTrigger id="dc-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCOUNT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {td(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("code")} htmlFor="dc-code">
              <Input id="dc-code" dir="ltr" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} data-testid="dc-code" />
            </Field>
            <Field label={t("nameEn")} htmlFor="dc-name-en">
              <Input id="dc-name-en" dir="ltr" value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="dc-name-en" />
            </Field>
            <Field label={t("nameAr")} htmlFor="dc-name-ar">
              <Input id="dc-name-ar" dir="rtl" value={f.nameAr} onChange={(e) => set("nameAr", e.target.value)} data-testid="dc-name-ar" />
            </Field>
            <Field label={t("method")} htmlFor="dc-method">
              <Select value={f.method} onValueChange={(v) => set("method", v as DiscountMethod)}>
                <SelectTrigger id="dc-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">{t("methodPercent")}</SelectItem>
                  <SelectItem value="FIXED">{t("methodFixed")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {f.method === "PERCENT" ? (
              <Field label={t("percent")} htmlFor="dc-pct">
                <Input id="dc-pct" dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="dc-pct" />
              </Field>
            ) : (
              <Field label={t("fixedAnnual")} htmlFor="dc-amt">
                <AmountInput id="dc-amt" value={amt} onChange={setAmt} />
              </Field>
            )}
            <ToggleRow id="dc-approval" label={t("requiresApproval")} hint={forced ? t("requiresApprovalForced") : t("requiresApprovalHint")} checked={forced || f.requiresApproval} onChange={(v) => set("requiresApproval", v)} disabled={forced} />
            <ToggleRow id="dc-active" label={t("active")} checked={f.active} onChange={(v) => set("active", v)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={!valid || pending} data-testid="dc-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CopyScheduleDialog({ years, toYearId }: { years: Array<{ id: string; name: string }>; toYearId: string }) {
  const t = useTranslations("finance.setup");
  const tc = useTranslations("common");
  const err = useFeeError();
  const router = useRouter();
  const sources = years.filter((y) => y.id !== toYearId);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(sources[0]?.id ?? "");
  const [pct, setPct] = useState("0");
  const [pending, start] = useTransition();
  const neg = pct.trim().startsWith("-");
  const bp = parsePercent(pct.replace(/^-/, ""));
  if (!sources.length) return null;
  const submit = () =>
    start(async () => {
      const res = await copyScheduleAction({ fromYearId: from, toYearId, changeBp: (bp ?? 0) * (neg ? -1 : 1) });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("copied", { items: res.items, plans: res.plans }));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="copy-schedule">
        <Copy className="size-4" />
        {t("copySchedule")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("copySchedule")}</DialogTitle>
            <DialogDescription>{t("copyBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("copyFrom")}>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("copyChange")} htmlFor="cp-pct" hint={t("copyChangeHint")}>
              <Input id="cp-pct" dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || bp === null || !from}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("copy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SyncAccountsButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const t = useTranslations("finance.accounts");
  const err = useFeeError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      data-testid="sync-accounts"
      onClick={() =>
        start(async () => {
          const res = await syncAccountsAction();
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(res.attached ? t("synced", { created: res.created, attached: res.attached }) : t("syncedNone"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {t("sync")}
    </Button>
  );
}
