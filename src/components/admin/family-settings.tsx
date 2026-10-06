"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveFeeSettingsAction, setWhatsAppKindsAction } from "@/server/admin/family-actions";

function useSave() {
  const t = useTranslations("fees.admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else toast.error(res.error && t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
    });
  return { pending, run };
}

export function FeeSettingsForm({ url, contact }: { url: string; contact: string }) {
  const t = useTranslations("fees.admin");
  const { pending, run } = useSave();
  const [v, setV] = useState({ url, contact });
  return (
    <div className="space-y-4" data-testid="fee-settings">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fee-url">{t("url")}</Label>
          <Input id="fee-url" dir="ltr" type="url" inputMode="url" placeholder="https://" value={v.url} onChange={(e) => setV((s) => ({ ...s, url: e.target.value }))} />
          <p className="text-xs text-muted-foreground">{t("urlHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fee-contact">{t("contact")}</Label>
          <Input id="fee-contact" value={v.contact} onChange={(e) => setV((s) => ({ ...s, contact: e.target.value }))} />
          <p className="text-xs text-muted-foreground">{t("contactHint")}</p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => run(() => saveFeeSettingsAction(v))} disabled={pending} data-testid="fee-save">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

export function WhatsAppKindsForm({ kinds, enabled }: { kinds: Array<{ kind: string; label: string }>; enabled: string[] }) {
  const t = useTranslations("fees.admin");
  const { pending, run } = useSave();
  const [on, setOn] = useState<string[]>(enabled);
  return (
    <div className="space-y-3" data-testid="whatsapp-kinds">
      <div className="grid gap-2 sm:grid-cols-2">
        {kinds.map((k) => (
          <label key={k.kind} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>{k.label}</span>
            <Switch checked={on.includes(k.kind)} aria-label={k.label} data-testid={`wa-kind-${k.kind}`} onCheckedChange={(c) => setOn((s) => (c ? [...s, k.kind] : s.filter((x) => x !== k.kind)))} />
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => run(() => setWhatsAppKindsAction({ kinds: on }))} disabled={pending} data-testid="whatsapp-kinds-save">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
