"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChipPicker, Field } from "@/components/calendar-admin/shared";
import { deletePartnerAction, savePartnerAction } from "@/server/partners/actions";
import type { PartnerInput } from "@/server/partners/service";

const CATEGORIES = ["career_experience", "advising", "test_prep", "scholarships", "internships", "other"];

function usePartnerError() {
  const t = useTranslations("partners");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export function PartnerDialog({ initial }: { initial?: PartnerInput }) {
  const t = useTranslations("partners");
  const tc = useTranslations("common");
  const err = usePartnerError();
  const router = useRouter();
  const blank: PartnerInput = { id: null, nameEn: "", nameAr: "", descEn: "", descAr: "", category: "career_experience", url: "https://", audience: ["student", "parent"], active: true };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<PartnerInput>(initial ?? blank);
  const [pending, start] = useTransition();
  const set = <K extends keyof PartnerInput>(k: K, v: PartnerInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.nameEn.trim().length > 1 && f.descEn.trim().length > 4 && f.url.trim().startsWith("https://") && f.audience.length > 0;
  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon-sm" onClick={() => (setF(initial), setOpen(true))} aria-label={t("edit")} title={t("edit")} data-testid="partner-edit">
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button onClick={() => (setF(blank), setOpen(true))} data-testid="partner-add">
          <Plus className="size-4" />
          {t("add")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("edit") : t("add")}</DialogTitle>
            <DialogDescription>{t("dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("field.nameEn")} htmlFor="pa-name-en">
                <Input id="pa-name-en" dir="ltr" value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="partner-name-en" />
              </Field>
              <Field label={t("field.nameAr")} htmlFor="pa-name-ar">
                <Input id="pa-name-ar" dir="rtl" value={f.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
              </Field>
              <Field label={t("field.descEn")} htmlFor="pa-desc-en">
                <Textarea id="pa-desc-en" dir="ltr" rows={3} value={f.descEn} onChange={(e) => set("descEn", e.target.value)} data-testid="partner-desc-en" />
              </Field>
              <Field label={t("field.descAr")} htmlFor="pa-desc-ar">
                <Textarea id="pa-desc-ar" dir="rtl" rows={3} value={f.descAr} onChange={(e) => set("descAr", e.target.value)} />
              </Field>
              <Field label={t("field.category")}>
                <Select value={f.category} onValueChange={(v) => set("category", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`category.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("field.url")} htmlFor="pa-url">
                <Input id="pa-url" dir="ltr" type="url" value={f.url} onChange={(e) => set("url", e.target.value)} data-testid="partner-url" />
              </Field>
            </div>
            <Field label={t("field.audience")}>
              <ChipPicker options={[{ value: "student", label: t("audience.student") }, { value: "parent", label: t("audience.parent") }]} value={f.audience} onChange={(v) => set("audience", v)} />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={f.active} onCheckedChange={(v) => set("active", v)} />
              {t("field.active")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || !valid}
              onClick={() =>
                start(async () => {
                  const res = await savePartnerAction(f);
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("saved"));
                  setOpen(false);
                  router.refresh();
                })
              }
              data-testid="partner-save"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeletePartnerButton({ id }: { id: string }) {
  const t = useTranslations("partners");
  const tc = useTranslations("common");
  const err = usePartnerError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label={tc("delete")} title={tc("delete")} data-testid="partner-delete">
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deletePartnerAction(id);
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("deleted"));
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
