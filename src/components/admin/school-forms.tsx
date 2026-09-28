"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Save } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import { saveCampusAction, saveDepartmentAction, setCurrentYearAction, updateSchoolProfileAction } from "@/server/admin/school-actions";

type Res = { ok: boolean; error?: string };

function useRun() {
  const t = useTranslations("adminSchool");
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

type Profile = Parameters<typeof updateSchoolProfileAction>[0];
const EMIRATES = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];

export function SchoolProfileForm({ initial }: { initial: Profile }) {
  const t = useTranslations("adminSchool");
  const { pending, run } = useRun();
  const [v, setV] = useState<Profile>(initial);
  const set = <K extends keyof Profile>(k: K, val: Profile[K]) => setV((s) => ({ ...s, [k]: val }));
  const days = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s-name-en">{t("nameEn")}</Label>
          <Input id="s-name-en" dir="ltr" value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-name-ar">{t("nameAr")}</Label>
          <Input id="s-name-ar" dir="rtl" value={v.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-short-en">{t("shortEn")}</Label>
          <Input id="s-short-en" dir="ltr" value={v.shortNameEn ?? ""} onChange={(e) => set("shortNameEn", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-short-ar">{t("shortAr")}</Label>
          <Input id="s-short-ar" dir="rtl" value={v.shortNameAr ?? ""} onChange={(e) => set("shortNameAr", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>{t("regulator")}</Label>
          <Select value={v.regulator} onValueChange={(r) => set("regulator", r as Profile["regulator"])}>
            <SelectTrigger className="w-full">
              <SelectValue>{t(`regulators.${v.regulator}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["KHDA", "ADEK", "SPEA", "MOE", "OTHER"] as const).map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`regulators.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("emirate")}</Label>
          <Select value={v.emirate} onValueChange={(e) => set("emirate", e)}>
            <SelectTrigger className="w-full">
              <SelectValue>{t(`emirates.${v.emirate.replace(/ /g, "_")}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EMIRATES.map((e) => (
                <SelectItem key={e} value={e}>
                  {t(`emirates.${e.replace(/ /g, "_")}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("defaultLanguage")}</Label>
          <Select value={v.defaultLocale} onValueChange={(l) => set("defaultLocale", l as "en" | "ar")}>
            <SelectTrigger className="w-full">
              <SelectValue>{v.defaultLocale === "ar" ? "العربية" : "English"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ar">العربية</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t("weekDays")}</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("weekDays")}>
          {days.map((d) => {
            const on = v.weekDays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => set("weekDays", on ? v.weekDays.filter((x) => x !== d) : [...v.weekDays, d])}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}
              >
                {t(`day.${d}`)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t("weekDaysHint")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-medium">{t("hijri")}</span>
            <span className="block text-xs text-muted-foreground">{t("hijriHint")}</span>
          </span>
          <Switch checked={v.hijriEnabled} onCheckedChange={(c) => set("hijriEnabled", c)} aria-label={t("hijri")} />
        </label>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-medium">{t("numerals")}</span>
            <span className="block text-xs text-muted-foreground">{t("numeralsHint")}</span>
          </span>
          <Select value={v.numerals} onValueChange={(n) => set("numerals", n as Profile["numerals"])}>
            <SelectTrigger className="w-28">
              <SelectValue>{v.numerals === "WESTERN" ? "123" : "١٢٣"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="WESTERN">123</SelectItem>
              <SelectItem value="ARABIC_INDIC">١٢٣</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => run(() => updateSchoolProfileAction(v))} disabled={pending} data-testid="school-save">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

export function DepartmentDialog({ department, staff }: { department?: { id: string; nameEn: string; nameAr: string; headMembershipId: string | null }; staff: PickerOption[] }) {
  const t = useTranslations("adminSchool");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [nameEn, setNameEn] = useState(department?.nameEn ?? "");
  const [nameAr, setNameAr] = useState(department?.nameAr ?? "");
  const [head, setHead] = useState(department?.headMembershipId ?? "");
  return (
    <>
      {department ? (
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(true)} aria-label={t("editDepartment")}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="add-department">
          <Plus className="size-4" />
          {t("addDepartment")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{department ? t("editDepartment") : t("addDepartment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="d-en">{t("nameEn")}</Label>
                <Input id="d-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-ar">{t("nameAr")}</Label>
                <Input id="d-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("head")}</Label>
              <PickerCombobox options={staff} value={head} onChange={setHead} placeholder={t("chooseHead")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || !nameEn.trim() || !nameAr.trim()} onClick={() => run(() => saveDepartmentAction({ id: department?.id, nameEn, nameAr, headMembershipId: head || null }), () => setOpen(false))}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CampusDialog({ campus }: { campus?: { id: string; nameEn: string; nameAr: string; addressEn: string | null; addressAr: string | null } }) {
  const t = useTranslations("adminSchool");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ nameEn: campus?.nameEn ?? "", nameAr: campus?.nameAr ?? "", addressEn: campus?.addressEn ?? "", addressAr: campus?.addressAr ?? "" });
  return (
    <>
      {campus ? (
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(true)} aria-label={t("editCampus")}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {t("addCampus")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{campus ? t("editCampus") : t("addCampus")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["nameEn", "nameAr", "addressEn", "addressAr"] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`c-${k}`}>{t(k)}</Label>
                <Input id={`c-${k}`} dir={k.endsWith("Ar") ? "rtl" : "ltr"} value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || !v.nameEn.trim() || !v.nameAr.trim()} onClick={() => run(() => saveCampusAction({ id: campus?.id, ...v }), () => setOpen(false))}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SetCurrentYear({ id }: { id: string }) {
  const t = useTranslations("adminSchool");
  const { pending, run } = useRun();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setCurrentYearAction({ id }))}>
      {t("makeCurrent")}
    </Button>
  );
}
