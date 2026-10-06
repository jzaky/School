"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteSchoolAction, schoolDeletionDryRunAction } from "@/server/platform/school-delete-actions";
import type { SchoolDeletionReport } from "@/server/platform/school-delete";

/** Platform admin: dry run, then typed confirmation, then delete the school. */
export function DeleteSchoolButton({ orgId, slug, name, blockedReason }: { orgId: string; slug: string; name: string; blockedReason: string | null }) {
  const t = useTranslations("platformSchools");
  const router = useRouter();
  const [report, setReport] = useState<SchoolDeletionReport | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const err = (code: string) => (t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));

  const dryRun = () =>
    start(async () => {
      const res = await schoolDeletionDryRunAction({ orgId });
      if (!res.ok) return void toast.error(err(res.error));
      setReport(res.report);
      setStep(1);
    });
  const remove = () =>
    start(async () => {
      const res = await deleteSchoolAction({ orgId, confirm });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("deleted", { rows: res.totalRows, files: res.files }));
      setStep(0);
      router.refresh();
    });

  if (blockedReason)
    return (
      <span title={blockedReason} className="inline-flex">
        <Button size="sm" variant="outline" disabled aria-label={blockedReason}>
          <Trash2 className="size-4" />
          {t("delete")}
        </Button>
      </span>
    );

  return (
    <>
      <Button size="sm" variant="outline" onClick={dryRun} disabled={pending} data-testid="school-dry-run">
        {pending && step === 0 ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        {t("delete")}
      </Button>
      <Dialog open={step > 0} onOpenChange={(o) => !o && setStep(0)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-danger" />
              {step === 1 ? t("dryRunTitle", { name }) : t("confirmTitle", { name })}
            </DialogTitle>
            <DialogDescription>{step === 1 ? t("dryRunBody") : t("confirmBody")}</DialogDescription>
          </DialogHeader>
          {step === 1 && report && (
            <div className="space-y-3 text-sm" data-testid="school-report">
              <p>{t("reportTotals", { rows: report.totalRows, tables: report.tables.length, files: report.files })}</p>
              <p className="text-xs text-muted-foreground">{t("reportUsers", { exclusive: report.users.exclusive, shared: report.users.shared })}</p>
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-xs">
                {report.tables.map((r) => (
                  <li key={r.table} className="flex justify-between gap-3 px-3 py-1.5">
                    <span dir="ltr">{r.table}</span>
                    <span className="tabular-nums">{r.rows}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t("reportAudit")}</p>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-1.5">
              <Label htmlFor={`del-${orgId}`}>{t("typeSlug", { slug })}</Label>
              <Input id={`del-${orgId}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" autoComplete="off" data-testid="school-delete-input" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep(0)}>
              {t("cancel")}
            </Button>
            {step === 1 ? (
              <Button variant="destructive" onClick={() => setStep(2)} data-testid="school-delete-continue">
                {t("continue")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            ) : (
              <Button variant="destructive" onClick={remove} disabled={pending || confirm.trim() !== slug} data-testid="school-delete-confirm">
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t("deleteForever")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
