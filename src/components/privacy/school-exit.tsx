"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Archive, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { requestSchoolExportAction } from "@/server/privacy/actions";

/** Starts a school-wide export after the admin types the school's code. */
export function RequestSchoolExport({ slug, busy }: { slug: string; busy: boolean }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("adminCompliance");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await requestSchoolExportAction({ confirm });
      if (!res.ok) {
        toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
        return;
      }
      toast.success(res.created ? t("exitQueued") : t("exitAlreadyRunning"));
      setOpen(false);
      setConfirm("");
      router.refresh();
    });
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={busy} title={busy ? t("exitBusy") : undefined} data-testid="exit-request">
        <Archive className="size-4" />
        {t("exitPrepare")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" />
              {t("exitConfirmTitle")}
            </DialogTitle>
            <DialogDescription>{t("exitConfirmBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="exit-confirm">{t("typeCode", { code: slug })}</Label>
            <Input id="exit-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" autoComplete="off" data-testid="exit-confirm-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || confirm.trim() !== slug} data-testid="exit-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("exitStart")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Refreshes the page every few seconds while an export is being built. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
