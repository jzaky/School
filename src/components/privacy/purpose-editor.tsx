"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { savePurposeAction } from "@/server/privacy/actions";

export type PurposeDraft = {
  id: string | null;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  basis: string;
  categories: string[];
  requiresConsent: boolean;
  retentionPolicyId: string | null;
};

const BASES = ["consent", "contract_with_the_family", "legal_obligation", "vital_interests", "vital_interests_and_legal_obligation", "legitimate_interest_with_opt_out", "public_interest"];
const CATEGORIES = ["identity", "contact", "academic", "attendance", "wellbeing", "safeguarding", "medical", "images", "career", "special_category"];

const EMPTY: PurposeDraft = { id: null, nameEn: "", nameAr: "", descEn: "", descAr: "", basis: "consent", categories: [], requiresConsent: true, retentionPolicyId: null };

export function PurposeEditor({ initial, policies }: { initial?: PurposeDraft; policies: Array<{ id: string; nameEn: string; nameAr: string }> }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("adminCompliance");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<PurposeDraft>(initial ?? EMPTY);
  const [pending, start] = useTransition();
  const set = <K extends keyof PurposeDraft>(k: K, v: PurposeDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const policyName = (id: string | null) => {
    const p = policies.find((x) => x.id === id);
    return p ? (locale === "ar" ? p.nameAr : p.nameEn) : t("purposeNoRetention");
  };
  const save = () =>
    start(async () => {
      const res = await savePurposeAction(d);
      if (!res.ok) {
        toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
        return;
      }
      toast.success(tc("saved"));
      setOpen(false);
      if (!initial) setD(EMPTY);
      router.refresh();
    });
  return (
    <>
      {initial ? (
        <Button size="icon" variant="ghost" className="size-8" aria-label={t("purposeEdit")} title={t("purposeEdit")} onClick={() => setOpen(true)} data-testid="purpose-edit">
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="purpose-add">
          <Plus className="size-4" />
          {t("purposeAdd")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("purposeEdit") : t("purposeAdd")}</DialogTitle>
            <DialogDescription>{t("purposeHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-name-en">{t("purposeNameEn")}</Label>
              <Input id="p-name-en" dir="ltr" value={d.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="purpose-name-en" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-name-ar">{t("purposeNameAr")}</Label>
              <Input id="p-name-ar" dir="rtl" value={d.nameAr} onChange={(e) => set("nameAr", e.target.value)} data-testid="purpose-name-ar" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc-en">{t("purposeDescEn")}</Label>
              <Textarea id="p-desc-en" dir="ltr" rows={2} value={d.descEn} onChange={(e) => set("descEn", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc-ar">{t("purposeDescAr")}</Label>
              <Textarea id="p-desc-ar" dir="rtl" rows={2} value={d.descAr} onChange={(e) => set("descAr", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("purposeBasis")}</Label>
              <Select value={d.basis} onValueChange={(v) => set("basis", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{tc(`basis.${d.basis}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {BASES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {tc(`basis.${b}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("purposeRetention")}</Label>
              <Select value={d.retentionPolicyId ?? "none"} onValueChange={(v) => set("retentionPolicyId", v === "none" ? null : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{policyName(d.retentionPolicyId)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("purposeNoRetention")}</SelectItem>
                  {policies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {locale === "ar" ? p.nameAr : p.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">{t("purposeCategories")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CATEGORIES.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={d.categories.includes(c)} onCheckedChange={(v) => set("categories", v === true ? [...d.categories, c] : d.categories.filter((x) => x !== c))} data-testid={`purpose-cat-${c}`} />
                    {tc(`category.${c}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
              <span>
                <span className="block font-medium">{t("purposeConsent")}</span>
                <span className="block text-xs text-muted-foreground">{t("purposeConsentHint")}</span>
              </span>
              <Switch checked={d.requiresConsent} onCheckedChange={(v) => set("requiresConsent", v)} aria-label={t("purposeConsent")} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={save} disabled={pending || d.nameEn.trim().length < 2 || d.nameAr.trim().length < 2 || !d.categories.length} data-testid="purpose-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
