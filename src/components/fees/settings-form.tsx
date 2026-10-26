"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { DiscountStacking, ProRataBasis } from "@prisma/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, PanelHeader } from "@/components/app/panel";
import { saveFinanceSettingsAction } from "@/server/fees/actions";
import type { SettingsInput } from "@/server/fees/schedule";
import { bpToInput, Field, parsePercent, ToggleRow, useFeeError } from "./form-bits";

type Section = "school" | "rules" | "online";

/** Finance settings, shown in parts on the setup page (school details, billing rules, online payment). */
export function SettingsForm({ initial, section, readOnly, online }: { initial: SettingsInput; section: Section; readOnly: boolean; online: { configured: boolean; ready: boolean; provider: string | null; test: boolean } }) {
  const t = useTranslations("finance.settings");
  const tc = useTranslations("common");
  const err = useFeeError();
  const router = useRouter();
  const [f, setF] = useState<SettingsInput>(initial);
  const [pct, setPct] = useState({ sib2: bpToInput(initial.siblingSecondBp), sib3: bpToInput(initial.siblingThirdBp), sib4: bpToInput(initial.siblingFourthBp), early: bpToInput(initial.earlyPaymentBp), vat: bpToInput(initial.standardVatBp) });
  const [after, setAfter] = useState(initial.reminderDaysAfter.join(", "));
  const [pending, start] = useTransition();
  const set = <K extends keyof SettingsInput>(k: K, v: SettingsInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const num = (s: string) => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const save = () =>
    start(async () => {
      const bps = { sib2: parsePercent(pct.sib2), sib3: parsePercent(pct.sib3), sib4: parsePercent(pct.sib4), early: parsePercent(pct.early), vat: parsePercent(pct.vat) };
      if (Object.values(bps).some((v) => v === null)) return void toast.error(err("PERCENT_INVALID"));
      const days = after.split(/[,\s،]+/).filter(Boolean).map(Number);
      if (days.some((d) => !Number.isInteger(d))) return void toast.error(err("DAYS_INVALID"));
      const res = await saveFinanceSettingsAction({ ...f, siblingSecondBp: bps.sib2!, siblingThirdBp: bps.sib3!, siblingFourthBp: bps.sib4!, earlyPaymentBp: bps.early!, standardVatBp: bps.vat!, reminderDaysAfter: days });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      router.refresh();
    });
  const footer = !readOnly && (
    <div className="flex justify-end">
      <Button onClick={save} disabled={pending} data-testid={`save-settings-${section}`}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {tc("save")}
      </Button>
    </div>
  );
  const ro = readOnly;

  if (section === "school") {
    return (
      <div className="space-y-4">
        <Panel>
          <PanelHeader title={t("legalTitle")} description={t("legalBody")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("legalNameEn")} htmlFor="st-ln-en">
              <Input id="st-ln-en" dir="ltr" value={f.legalNameEn} onChange={(e) => set("legalNameEn", e.target.value)} disabled={ro} data-testid="st-legal-en" />
            </Field>
            <Field label={t("legalNameAr")} htmlFor="st-ln-ar">
              <Input id="st-ln-ar" dir="rtl" value={f.legalNameAr} onChange={(e) => set("legalNameAr", e.target.value)} disabled={ro} data-testid="st-legal-ar" />
            </Field>
            <Field label={t("addressEn")} htmlFor="st-ad-en">
              <Textarea id="st-ad-en" dir="ltr" rows={2} value={f.addressEn} onChange={(e) => set("addressEn", e.target.value)} disabled={ro} data-testid="st-address-en" />
            </Field>
            <Field label={t("addressAr")} htmlFor="st-ad-ar">
              <Textarea id="st-ad-ar" dir="rtl" rows={2} value={f.addressAr} onChange={(e) => set("addressAr", e.target.value)} disabled={ro} />
            </Field>
            <ToggleRow id="st-vatreg" label={t("vatRegistered")} hint={t("vatRegisteredHint")} checked={f.vatRegistered} onChange={(v) => set("vatRegistered", v)} disabled={ro} />
            <Field label={t("trn")} htmlFor="st-trn" hint={t("trnHint")}>
              <Input id="st-trn" dir="ltr" inputMode="numeric" value={f.trn} onChange={(e) => set("trn", e.target.value.replace(/\D/g, "").slice(0, 15))} disabled={ro || !f.vatRegistered} data-testid="st-trn" />
            </Field>
            <Field label={t("vatRate")} htmlFor="st-vat" hint={t("vatRateHint")}>
              <Input id="st-vat" dir="ltr" inputMode="decimal" value={pct.vat} onChange={(e) => setPct((p) => ({ ...p, vat: e.target.value }))} disabled={ro} />
            </Field>
            <Field label={t("terms")} htmlFor="st-terms" hint={t("termsHint")}>
              <Input id="st-terms" dir="ltr" inputMode="numeric" value={String(f.paymentTermsDays)} onChange={(e) => set("paymentTermsDays", num(e.target.value))} disabled={ro} />
            </Field>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("numberingTitle")} description={t("numberingBody")} />
          <div className="grid gap-3 sm:grid-cols-5">
            {(["invoicePrefix", "proformaPrefix", "creditNotePrefix", "receiptPrefix", "refundPrefix"] as const).map((k) => (
              <Field key={k} label={t(k)} htmlFor={`st-${k}`}>
                <Input id={`st-${k}`} dir="ltr" value={f[k]} onChange={(e) => set(k, e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))} disabled={ro} />
              </Field>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("bankTitle")} description={t("bankBody")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("bankEn")} htmlFor="st-bank-en">
              <Textarea id="st-bank-en" dir="ltr" rows={3} value={f.bankDetailsEn} onChange={(e) => set("bankDetailsEn", e.target.value)} disabled={ro} />
            </Field>
            <Field label={t("bankAr")} htmlFor="st-bank-ar">
              <Textarea id="st-bank-ar" dir="rtl" rows={3} value={f.bankDetailsAr} onChange={(e) => set("bankDetailsAr", e.target.value)} disabled={ro} />
            </Field>
          </div>
        </Panel>
        {footer}
      </div>
    );
  }

  if (section === "rules") {
    return (
      <div className="space-y-4">
        <Panel>
          <PanelHeader title={t("siblingTitle")} description={t("siblingBody")} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("sib2")} htmlFor="st-s2">
              <Input id="st-s2" dir="ltr" inputMode="decimal" value={pct.sib2} onChange={(e) => setPct((p) => ({ ...p, sib2: e.target.value }))} disabled={ro} data-testid="st-sib2" />
            </Field>
            <Field label={t("sib3")} htmlFor="st-s3">
              <Input id="st-s3" dir="ltr" inputMode="decimal" value={pct.sib3} onChange={(e) => setPct((p) => ({ ...p, sib3: e.target.value }))} disabled={ro} />
            </Field>
            <Field label={t("sib4")} htmlFor="st-s4">
              <Input id="st-s4" dir="ltr" inputMode="decimal" value={pct.sib4} onChange={(e) => setPct((p) => ({ ...p, sib4: e.target.value }))} disabled={ro} />
            </Field>
            <Field label={t("stacking")} htmlFor="st-stack" className="sm:col-span-3" hint={f.discountStacking === "STACK" ? t("stackingStackHint") : t("stackingBestHint")}>
              <Select value={f.discountStacking} onValueChange={(v) => set("discountStacking", v as DiscountStacking)} disabled={ro}>
                <SelectTrigger id="st-stack">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STACK">{t("stackingStack")}</SelectItem>
                  <SelectItem value="BEST_ONLY">{t("stackingBest")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("earlyTitle")} description={t("earlyBody")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("earlyPct")} htmlFor="st-early">
              <Input id="st-early" dir="ltr" inputMode="decimal" value={pct.early} onChange={(e) => setPct((p) => ({ ...p, early: e.target.value }))} disabled={ro} />
            </Field>
            <Field label={t("earlyDays")} htmlFor="st-early-days">
              <Input id="st-early-days" dir="ltr" inputMode="numeric" value={String(f.earlyPaymentDays)} onChange={(e) => set("earlyPaymentDays", num(e.target.value))} disabled={ro} />
            </Field>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("proRataTitle")} description={t("proRataBody")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("proRataBasis")} htmlFor="st-pr" hint={t(`proRataHint.${f.proRataBasis}`)}>
              <Select value={f.proRataBasis} onValueChange={(v) => set("proRataBasis", v as ProRataBasis)} disabled={ro}>
                <SelectTrigger id="st-pr">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["MONTH", "DAY", "TERM", "NONE"] as const).map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`proRata.${b}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("cutoff")} htmlFor="st-cut" hint={t("cutoffHint")}>
              <Input id="st-cut" dir="ltr" inputMode="numeric" value={String(f.proRataCutoffDay)} onChange={(e) => set("proRataCutoffDay", num(e.target.value))} disabled={ro || f.proRataBasis !== "MONTH"} />
            </Field>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("remindersTitle")} description={t("remindersBody")} />
          <div className="grid gap-3 sm:grid-cols-3">
            <ToggleRow id="st-rem" label={t("remindersOn")} checked={f.remindersEnabled} onChange={(v) => set("remindersEnabled", v)} disabled={ro} />
            <Field label={t("daysBefore")} htmlFor="st-before">
              <Input id="st-before" dir="ltr" inputMode="numeric" value={String(f.reminderDaysBefore)} onChange={(e) => set("reminderDaysBefore", num(e.target.value))} disabled={ro || !f.remindersEnabled} />
            </Field>
            <Field label={t("daysAfter")} htmlFor="st-after" hint={t("daysAfterHint")}>
              <Input id="st-after" dir="ltr" value={after} onChange={(e) => setAfter(e.target.value)} disabled={ro || !f.remindersEnabled} />
            </Field>
          </div>
        </Panel>
        <Panel className="border-warning/40">
          <PanelHeader title={t("holdTitle")} description={t("holdBody")} icon={<AlertTriangle className="size-4 text-warning" />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleRow id="st-hold" label={t("holdOn")} hint={t("holdOnHint")} checked={f.holdReportCards} onChange={(v) => set("holdReportCards", v)} disabled={ro} />
            <Field label={t("holdDays")} htmlFor="st-hold-days" hint={t("holdDaysHint")}>
              <Input id="st-hold-days" dir="ltr" inputMode="numeric" value={String(f.holdAfterDays)} onChange={(e) => set("holdAfterDays", num(e.target.value))} disabled={ro || !f.holdReportCards} />
            </Field>
          </div>
        </Panel>
        {footer}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title={t("onlineTitle")} description={t("onlineBody")} />
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="online-status">
            {!online.configured ? t("onlineNotSetUp") : online.ready ? (online.test ? t("onlineReadyTest", { provider: online.provider ?? "" }) : t("onlineReady", { provider: online.provider ?? "" })) : t("onlineIncomplete", { provider: online.provider ?? "" })}
          </div>
          <ToggleRow id="st-online" label={t("onlineOn")} hint={online.ready ? t("onlineOnHint") : t("onlineOnDisabled")} checked={f.onlinePayments && online.ready} onChange={(v) => set("onlinePayments", v)} disabled={ro || !online.ready} />
        </div>
      </Panel>
      {footer}
    </div>
  );
}
