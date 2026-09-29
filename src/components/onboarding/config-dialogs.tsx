"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveMessageTemplateAction, saveSubjectAction } from "@/server/onboarding/config-actions";

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function useSave(close: () => void) {
  const t = useTranslations("onboarding.config");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t("errors.generic"));
      toast.success(t("saved"));
      close();
      router.refresh();
    });
  return { pending, run };
}

type Subject = { id: string; code: string; nameEn: string; nameAr: string; departmentId: string | null };

export function SubjectDialog({ subject, departments }: { subject?: Subject; departments: Array<{ id: string; label: string }> }) {
  const t = useTranslations("onboarding.config");
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ code: subject?.code ?? "", nameEn: subject?.nameEn ?? "", nameAr: subject?.nameAr ?? "", departmentId: subject?.departmentId ?? "" });
  const { pending, run } = useSave(() => setOpen(false));
  return (
    <>
      {subject ? (
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(true)} aria-label={t("editSubject")}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="add-subject">
          <Plus className="size-4" />
          {t("addSubject")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{subject ? t("editSubject") : t("addSubject")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-code">{t("code")}</Label>
              <Input id="s-code" dir="ltr" className="text-start font-mono uppercase" value={v.code} maxLength={12} onChange={(e) => setV({ ...v, code: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-dept">{t("department")}</Label>
              <select id="s-dept" className={selectClass} value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}>
                <option value="">{t("noDepartment")}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-en">{t("nameEn")}</Label>
              <Input id="s-en" dir="ltr" value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-ar">{t("nameAr")}</Label>
              <Input id="s-ar" dir="rtl" value={v.nameAr} onChange={(e) => setV({ ...v, nameAr: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || !v.code.trim() || !v.nameEn.trim() || !v.nameAr.trim()} onClick={() => run(() => saveSubjectAction({ id: subject?.id, ...v, departmentId: v.departmentId || null }))}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Template = { id: string; key: string; channel: string; subjectEn: string | null; subjectAr: string | null; bodyEn: string; bodyAr: string };

export function MessageTemplateDialog({ template, label }: { template: Template; label: string }) {
  const t = useTranslations("onboarding.config");
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ subjectEn: template.subjectEn ?? "", subjectAr: template.subjectAr ?? "", bodyEn: template.bodyEn, bodyAr: template.bodyAr });
  const { pending, run } = useSave(() => setOpen(false));
  const email = template.channel === "EMAIL";
  return (
    <>
      <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(true)} aria-label={t("editMessage")} data-testid="edit-message">
        <Pencil className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{t("messageHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {email && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="m-sen">{t("subjectEn")}</Label>
                  <Input id="m-sen" dir="ltr" value={v.subjectEn} onChange={(e) => setV({ ...v, subjectEn: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-sar">{t("subjectAr")}</Label>
                  <Input id="m-sar" dir="rtl" value={v.subjectAr} onChange={(e) => setV({ ...v, subjectAr: e.target.value })} />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="m-ben">{t("bodyEn")}</Label>
              <Textarea id="m-ben" dir="ltr" rows={5} value={v.bodyEn} onChange={(e) => setV({ ...v, bodyEn: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-bar">{t("bodyAr")}</Label>
              <Textarea id="m-bar" dir="rtl" rows={5} value={v.bodyAr} onChange={(e) => setV({ ...v, bodyAr: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || !v.bodyEn.trim() || !v.bodyAr.trim()} onClick={() => run(() => saveMessageTemplateAction({ id: template.id, subjectEn: v.subjectEn || null, subjectAr: v.subjectAr || null, bodyEn: v.bodyEn, bodyAr: v.bodyAr }))}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
