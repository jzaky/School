"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createWorkflowAction } from "@/server/admin/workflow-actions";

export function NewWorkflowButton() {
  const t = useTranslations("adminWorkflows");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [descEn, setDescEn] = useState("");
  const [descAr, setDescAr] = useState("");

  const submit = () =>
    start(async () => {
      const res = await createWorkflowAction({ nameEn, nameAr, descEn, descAr });
      if (!res.ok) return void toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
      toast.success(t("created"));
      setOpen(false);
      router.push(`/admin/workflows/${res.id}`);
    });

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-workflow">
        <Plus className="size-4" />
        {t("newWorkflow")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("newTitle")}</DialogTitle>
            <DialogDescription>{t("newBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wf-name-en">{t("nameEn")}</Label>
                <Input id="wf-name-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="wf-name-en" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-name-ar">{t("nameAr")}</Label>
                <Input id="wf-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} data-testid="wf-name-ar" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wf-desc-en">{t("descEn")}</Label>
                <Textarea id="wf-desc-en" dir="ltr" rows={3} value={descEn} onChange={(e) => setDescEn(e.target.value)} placeholder={t("optional")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-desc-ar">{t("descAr")}</Label>
                <Textarea id="wf-desc-ar" dir="rtl" rows={3} value={descAr} onChange={(e) => setDescAr(e.target.value)} placeholder={t("optional")} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !nameEn.trim() || !nameAr.trim()} data-testid="wf-create">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
