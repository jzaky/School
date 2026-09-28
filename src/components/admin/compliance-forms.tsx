"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { setTransferApprovalAction, updateDataSettingsAction, updateDsrAction, updateRetentionAction } from "@/server/admin/compliance-actions";

type Res = { ok: boolean; error?: string };

function useRun() {
  const t = useTranslations("adminCompliance");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(t("saved"));
        after?.();
        router.refresh();
      } else toast.error(res.error && t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
    });
  return { pending, run };
}

function SettingRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function AiSettings({ aiEnabled, aiSensitive }: { aiEnabled: boolean; aiSensitive: boolean }) {
  const t = useTranslations("adminCompliance");
  const { pending, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="divide-y">
      <SettingRow title={t("aiEnabled")} hint={t("aiEnabledHint")}>
        <Switch checked={aiEnabled} disabled={pending} aria-label={t("aiEnabled")} onCheckedChange={(v) => run(() => updateDataSettingsAction({ aiEnabled: v }))} data-testid="ai-enabled" />
      </SettingRow>
      <SettingRow title={t("aiSensitive")} hint={t("aiSensitiveHint")}>
        <Switch
          checked={aiSensitive}
          disabled={pending || !aiEnabled}
          aria-label={t("aiSensitive")}
          onCheckedChange={(v) => (v ? setConfirm(true) : run(() => updateDataSettingsAction({ aiSensitiveDataEnabled: false })))}
          data-testid="ai-sensitive"
        />
      </SettingRow>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" />
              {t("confirmTitle")}
            </DialogTitle>
            <DialogDescription>{t("confirmBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ai-reason">{t("reasonLabel")}</Label>
            <Textarea id="ai-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("reasonPlaceholder")} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 10}
              onClick={() =>
                run(
                  () => updateDataSettingsAction({ aiSensitiveDataEnabled: true, reason }),
                  () => {
                    setConfirm(false);
                    setReason("");
                  },
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("confirmEnable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function IdentitySettings({ emiratesIdPolicy, passportPolicy, crossBorderAllowed }: { emiratesIdPolicy: string; passportPolicy: string; crossBorderAllowed: boolean }) {
  const t = useTranslations("adminCompliance");
  const { pending, run } = useRun();
  const policySelect = (value: string, key: "emiratesIdPolicy" | "passportPolicy") => (
    <Select value={value} onValueChange={(v) => run(() => updateDataSettingsAction({ [key]: v as "OFF" | "OPTIONAL" | "REQUIRED" }))} disabled={pending}>
      <SelectTrigger className="w-36">
        <SelectValue>{t(`policy.${value}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(["OFF", "OPTIONAL", "REQUIRED"] as const).map((p) => (
          <SelectItem key={p} value={p}>
            {t(`policy.${p}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="divide-y">
      <SettingRow title={t("emiratesId")} hint={t("emiratesIdHint")}>
        {policySelect(emiratesIdPolicy, "emiratesIdPolicy")}
      </SettingRow>
      <SettingRow title={t("passport")} hint={t("passportHint")}>
        {policySelect(passportPolicy, "passportPolicy")}
      </SettingRow>
      <SettingRow title={t("crossBorder")} hint={t("crossBorderHint")}>
        <Switch checked={crossBorderAllowed} disabled={pending} aria-label={t("crossBorder")} onCheckedChange={(v) => run(() => updateDataSettingsAction({ crossBorderAllowed: v }))} />
      </SettingRow>
    </div>
  );
}

export function RetentionEditor({ id, days, action, locked }: { id: string; days: number; action: string; locked: boolean }) {
  const t = useTranslations("adminCompliance");
  const { pending, run } = useRun();
  const [years, setYears] = useState(String(Math.round((days / 365) * 10) / 10));
  const [act, setAct] = useState(action);
  const dirty = Number(years) * 365 !== days || act !== action;
  return (
    <div className="flex items-center gap-2">
      <Input type="number" min={0.1} step={0.5} value={years} onChange={(e) => setYears(e.target.value)} className="h-8 w-20" aria-label={t("years")} />
      <span className="text-xs text-muted-foreground">{t("yearsUnit")}</span>
      <Select value={act} onValueChange={setAct} disabled={locked}>
        <SelectTrigger className="h-8 w-32" title={locked ? t("safeguardingLocked") : undefined}>
          <SelectValue>{t(`retention.${act}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(["REVIEW", "ANONYMIZE", "DELETE"] as const).map((a) => (
            <SelectItem key={a} value={a}>
              {t(`retention.${a}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="icon" variant="ghost" className="size-8" disabled={!dirty || pending} aria-label={t("save")} onClick={() => run(() => updateRetentionAction({ id, retentionDays: Number(years) * 365, action: act as "REVIEW" }))}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      </Button>
    </div>
  );
}

export function TransferToggle({ id, approved }: { id: string; approved: boolean }) {
  const t = useTranslations("adminCompliance");
  const { pending, run } = useRun();
  return <Switch checked={approved} disabled={pending} aria-label={t("approved")} onCheckedChange={(v) => run(() => setTransferApprovalAction({ id, approved: v }))} />;
}

export function DsrStatusControl({ id, status }: { id: string; status: string }) {
  const t = useTranslations("adminCompliance");
  const { pending, run } = useRun();
  const [closing, setClosing] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  return (
    <>
      <Select
        value={status}
        disabled={pending}
        onValueChange={(v) => (v === "COMPLETED" || v === "REJECTED" ? setClosing(v) : run(() => updateDsrAction({ id, status: v as "RECEIVED" })))}
      >
        <SelectTrigger className="h-8 w-40">
          <SelectValue>{t(`dsrStatus.${status}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(["RECEIVED", "VERIFYING", "IN_PROGRESS", "COMPLETED", "REJECTED"] as const).map((s) => (
            <SelectItem key={s} value={s}>
              {t(`dsrStatus.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{closing ? t(`dsrStatus.${closing}`) : ""}</DialogTitle>
            <DialogDescription>{t("resolutionHint")}</DialogDescription>
          </DialogHeader>
          <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} placeholder={t("resolutionPlaceholder")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || !resolution.trim()} onClick={() => run(() => updateDsrAction({ id, status: closing as "COMPLETED", resolution }), () => setClosing(null))}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
