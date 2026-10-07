"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MODULES, type PricingConfig } from "@/lib/roi";
import { savePricingAction, type PricingState } from "@/server/marketing/platform-actions";

export function PricingSettingsForm({ initial }: { initial: PricingConfig }) {
  const t = useTranslations("growth.platform.pricing");
  const tm = useTranslations("growth.pricing");
  const [state, action, pending] = useActionState<PricingState, FormData>(savePricingAction, { ok: false });
  const [published, setPublished] = useState(initial.published);
  const [corePrice, setCorePrice] = useState(initial.perStudent.core == null ? "" : String(initial.perStudent.core));

  useEffect(() => {
    if (state.ok && state.savedAt) toast.success(t("saved"));
  }, [state, t]);

  const field = (name: string, label: string, value: number | null | string, opts: { step?: number; max?: number; hint?: string } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={0} max={opts.max} step={opts.step ?? 0.01} defaultValue={value ?? ""} dir="ltr" className="w-40 tabular-nums" data-testid={`setting-${name}`} />
      {opts.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
    </div>
  );

  return (
    <form action={action} className="space-y-6" data-testid="pricing-settings">
      <section className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="currency">{t("currency")}</Label>
          <Input id="currency" name="currency" defaultValue={initial.currency} maxLength={3} dir="ltr" className="w-24 uppercase" />
        </div>
        <p className="text-sm font-medium">{t("perStudent")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) =>
            m === "core" ? (
              <div key={m} className="space-y-1.5">
                <Label htmlFor="price_core">{tm(`module.${m}`)}</Label>
                <Input id="price_core" name="price_core" type="number" min={0} step={0.01} value={corePrice} onChange={(e) => setCorePrice(e.target.value)} dir="ltr" className="w-40 tabular-nums" data-testid="setting-price_core" />
              </div>
            ) : (
              <div key={m}>{field(`price_${m}`, tm(`module.${m}`), initial.perStudent[m])}</div>
            ),
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("perStudentHint")}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {field("pilotDiscountPct", t("pilotDiscount"), initial.pilotDiscountPct, { step: 1, max: 100 })}
        {field("pilotMonths", t("pilotMonths"), initial.pilotMonths, { step: 1, max: 12 })}
        {field("minimumAnnual", t("minimumAnnual"), initial.minimumAnnual, { hint: t("minimumHint") })}
        {field("minimumPerCampus", t("minimumPerCampus"), initial.minimumPerCampus, { hint: t("minimumHint") })}
      </section>
      <label className="flex items-start gap-3 rounded-xl border p-4">
        <Switch checked={published && Boolean(corePrice.trim())} onCheckedChange={setPublished} disabled={!corePrice.trim()} data-testid="setting-published" />
        <span className="text-sm">
          <span className="block font-medium">{t("published")}</span>
          <span className="block text-xs text-muted-foreground">{corePrice.trim() ? t("publishedHint") : t("publishedNeedsCore")}</span>
        </span>
      </label>
      {published && corePrice.trim() && <input type="hidden" name="published" value="on" />}
      {state.error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {t(`error.${state.error}`)}
        </p>
      )}
      <Button type="submit" disabled={pending} data-testid="pricing-settings-save">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t("save")}
      </Button>
    </form>
  );
}
