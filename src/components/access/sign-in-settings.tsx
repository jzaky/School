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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { updateJoinSettingsAction } from "@/server/access/actions";

export type SignInSettingsValue = {
  googleSignIn: boolean;
  microsoftSignIn: boolean;
  staffEmailDomains: string[];
  staffDomainAutoApprove: boolean;
  parentSelfJoin: boolean;
  parentJoinApproval: boolean;
  studentSelfJoin: boolean;
};

function Row({ id, title, body, checked, onChange, disabled, lock, testId }: { id: string; title: string; body: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; lock?: string; testId: string }) {
  const sw = <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} data-testid={testId} />;
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
      {lock ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{sw}</span>
          </TooltipTrigger>
          <TooltipContent>{lock}</TooltipContent>
        </Tooltip>
      ) : (
        sw
      )}
    </div>
  );
}

export function SignInSettings({ initial, providers, canEdit }: { initial: SignInSettingsValue; providers: { google: boolean; microsoft: boolean }; canEdit: boolean }) {
  const t = useTranslations("adminInvites");
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [domains, setDomains] = useState(initial.staffEmailDomains.join(", "));
  const [pending, start] = useTransition();
  const set = (patch: Partial<SignInSettingsValue>) => setV((cur) => ({ ...cur, ...patch }));
  const readOnly = canEdit ? undefined : t("settingsReadOnly");
  const save = () =>
    start(async () => {
      const res = await updateJoinSettingsAction({ ...v, staffEmailDomains: domains.split(/[,\s]+/).filter(Boolean) });
      if (!res.ok) return void toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
      setDomains(res.settings.staffEmailDomains.join(", "));
      toast.success(t("settingsSaved"));
      router.refresh();
    });
  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="border-b px-5 py-3">
          <h2 className="text-sm font-semibold">{t("methodsTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("methodsBody")}</p>
        </div>
        <div className="divide-y">
          <Row id="m-password" title={t("methodPassword")} body={t("methodPasswordBody")} checked disabled lock={t("methodPasswordLock")} testId="setting-password" />
          <Row
            id="m-google"
            title={t("methodGoogle")}
            body={t("methodGoogleBody")}
            checked={providers.google && v.googleSignIn}
            onChange={(c) => set({ googleSignIn: c })}
            disabled={!providers.google || !canEdit}
            lock={!providers.google ? t("providerMissing") : readOnly}
            testId="setting-google"
          />
          <Row
            id="m-microsoft"
            title={t("methodMicrosoft")}
            body={t("methodMicrosoftBody")}
            checked={providers.microsoft && v.microsoftSignIn}
            onChange={(c) => set({ microsoftSignIn: c })}
            disabled={!providers.microsoft || !canEdit}
            lock={!providers.microsoft ? t("providerMissing") : readOnly}
            testId="setting-microsoft"
          />
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="border-b px-5 py-3">
          <h2 className="text-sm font-semibold">{t("joinTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("joinBody")}</p>
        </div>
        <div className="divide-y">
          <div className="space-y-2 px-5 py-4">
            <Label htmlFor="staff-domains" className="text-sm font-medium">
              {t("staffDomains")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("staffDomainsBody")}</p>
            <Input id="staff-domains" dir="ltr" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={t("staffDomainsPlaceholder")} disabled={!canEdit} data-testid="setting-domains" />
          </div>
          <Row id="s-auto" title={t("staffAutoApprove")} body={t("staffAutoApproveBody")} checked={v.staffDomainAutoApprove} onChange={(c) => set({ staffDomainAutoApprove: c })} disabled={!canEdit} lock={readOnly} testId="setting-staff-auto" />
          <Row id="p-join" title={t("parentSelfJoin")} body={t("parentSelfJoinBody")} checked={v.parentSelfJoin} onChange={(c) => set({ parentSelfJoin: c })} disabled={!canEdit} lock={readOnly} testId="setting-parent-join" />
          <Row id="p-approval" title={t("parentApproval")} body={t("parentApprovalBody")} checked={v.parentJoinApproval} onChange={(c) => set({ parentJoinApproval: c })} disabled={!canEdit} lock={readOnly} testId="setting-parent-approval" />
          <Row id="s-join" title={t("studentSelfJoin")} body={t("studentSelfJoinBody")} checked={v.studentSelfJoin} onChange={(c) => set({ studentSelfJoin: c })} disabled={!canEdit} lock={readOnly} testId="setting-student-join" />
        </div>
      </section>
      {canEdit && (
        <div className="flex">
          <Button onClick={save} disabled={pending} data-testid="settings-save">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("saveSettings")}
          </Button>
        </div>
      )}
    </div>
  );
}
