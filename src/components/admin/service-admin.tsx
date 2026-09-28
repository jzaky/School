"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Lock, Pencil, Plus } from "lucide-react";
import type { Sensitivity } from "@prisma/client";
import { cn } from "@/lib/utils";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/icon";
import { saveServiceAction, setServiceActiveAction, type AudienceGroup } from "@/server/admin/services-actions";

export type EditorOptions = {
  categories: Array<{ id: string; label: string; icon: string }>;
  forms: Array<{ id: string; label: string }>;
  workflows: Array<{ id: string; label: string }>;
};

export type ServiceDraft = {
  id: string | null;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  icon: string;
  categoryId: string;
  audience: AudienceGroup[];
  slaHours: number;
  formId: string | null;
  workflowId: string | null;
  isFeatured: boolean;
  requiresStudent: boolean;
  sensitivity: Sensitivity;
};

// Icons offered for services. All are bundled in components/icon.tsx.
const ICONS = [
  "file-text",
  "book-open",
  "graduation-cap",
  "brain",
  "heart",
  "heart-handshake",
  "heart-pulse",
  "stethoscope",
  "compass",
  "briefcase",
  "calendar",
  "calendar-check",
  "calendar-clock",
  "calendar-x",
  "clock",
  "mail",
  "message-circle",
  "message-square",
  "laptop",
  "monitor",
  "wrench",
  "bus",
  "map",
  "school",
  "trophy",
  "puzzle",
  "id-card",
  "lock",
  "clipboard-check",
  "arrow-left-right",
  "flag",
  "users",
  "shield",
  "shield-alert",
  "stamp",
  "scale",
];

const AUDIENCE: AudienceGroup[] = ["student", "parent", "staff"];
const NONE = "__none__";

function useErr() {
  const t = useTranslations("adminServices");
  return (code?: string) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
}

export function ServiceActiveToggle({ id, active, locked, name }: { id: string; active: boolean; locked: boolean; name: string }) {
  const t = useTranslations("adminServices");
  const err = useErr();
  const router = useRouter();
  const [pending, start] = useTransition();
  const control = (
    <Switch
      checked={active}
      disabled={pending || (locked && active)}
      aria-label={t("toggleLabel", { name })}
      data-testid="service-toggle"
      onCheckedChange={(v) =>
        start(async () => {
          const res = await setServiceActiveAction({ id, active: v });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(v ? t("enabled", { name }) : t("disabled", { name }));
          router.refresh();
        })
      }
    />
  );
  if (!(locked && active)) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{control}</span>
      </TooltipTrigger>
      <TooltipContent>{t("errors.SAFEGUARDING_ALWAYS_ON")}</TooltipContent>
    </Tooltip>
  );
}

const EMPTY = (categoryId: string): ServiceDraft => ({
  id: null,
  nameEn: "",
  nameAr: "",
  descEn: "",
  descAr: "",
  icon: "file-text",
  categoryId,
  audience: ["student", "parent"],
  slaHours: 72,
  formId: null,
  workflowId: null,
  isFeatured: false,
  requiresStudent: true,
  sensitivity: "STANDARD",
});

export function ServiceEditor({ options, service }: { options: EditorOptions; service?: ServiceDraft }) {
  const t = useTranslations("adminServices");
  const ts = useTranslations("status");
  const err = useErr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [d, setD] = useState<ServiceDraft>(service ?? EMPTY(options.categories[0]?.id ?? ""));
  const set = (patch: Partial<ServiceDraft>) => setD((x) => ({ ...x, ...patch }));
  const isNew = !service;
  const protectedSens = d.sensitivity === "WELLBEING" || d.sensitivity === "SAFEGUARDING";
  const category = options.categories.find((c) => c.id === d.categoryId);
  const form = options.forms.find((f) => f.id === d.formId);
  const workflow = options.workflows.find((w) => w.id === d.workflowId);

  const openEditor = () => {
    setD(service ?? EMPTY(options.categories[0]?.id ?? ""));
    setOpen(true);
  };

  const save = () =>
    start(async () => {
      const res = await saveServiceAction({ ...d, slaHours: Number(d.slaHours) });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(isNew ? t("created") : t("saved"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {isNew ? (
        <Button onClick={openEditor} data-testid="service-new" disabled={!options.categories.length}>
          <Plus className="size-4" />
          {t("newService")}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={openEditor} aria-label={t("editNamed", { name: d.nameEn })} data-testid="service-edit">
              <Pencil className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("edit")}</TooltipContent>
        </Tooltip>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
          <SheetHeader className="border-b">
            <SheetTitle>{isNew ? t("newService") : t("editTitle")}</SheetTitle>
            <SheetDescription>{t("editBody")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto p-4" data-testid="service-editor">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="svc-name-en">{t("nameEn")}</Label>
                <Input id="svc-name-en" dir="ltr" value={d.nameEn} onChange={(e) => set({ nameEn: e.target.value })} data-testid="svc-name-en" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-name-ar">{t("nameAr")}</Label>
                <Input id="svc-name-ar" dir="rtl" value={d.nameAr} onChange={(e) => set({ nameAr: e.target.value })} data-testid="svc-name-ar" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-desc-en">{t("descEn")}</Label>
                <Textarea id="svc-desc-en" dir="ltr" rows={3} value={d.descEn} onChange={(e) => set({ descEn: e.target.value })} data-testid="svc-desc-en" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-desc-ar">{t("descAr")}</Label>
                <Textarea id="svc-desc-ar" dir="rtl" rows={3} value={d.descAr} onChange={(e) => set({ descAr: e.target.value })} data-testid="svc-desc-ar" />
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t("icon")}</span>
              <div className="grid grid-cols-9 gap-1 rounded-lg border p-2" role="radiogroup" aria-label={t("icon")}>
                {ICONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={d.icon === name}
                    aria-label={name}
                    onClick={() => set({ icon: name })}
                    className={cn("grid aspect-square place-items-center rounded-md transition", d.icon === name ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                  >
                    <Icon name={name} className="size-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("category")}</Label>
                <Select value={d.categoryId} onValueChange={(v) => set({ categoryId: v })}>
                  <SelectTrigger className="w-full" data-testid="svc-category">
                    <SelectValue>{category?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {options.categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-sla">{t("slaHours")}</Label>
                <Input id="svc-sla" type="number" min={1} max={2160} value={d.slaHours} onChange={(e) => set({ slaHours: Number(e.target.value) })} data-testid="svc-sla" />
                <p className="text-xs text-muted-foreground">{t("slaHint")}</p>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">{t("whoCanRequest")}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {AUDIENCE.map((g) => {
                  const on = d.audience.includes(g);
                  return (
                    <label key={g} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", on && "border-brand bg-brand-soft/50")}>
                      <Checkbox checked={on} onCheckedChange={(c) => set({ audience: c === true ? [...d.audience, g] : d.audience.filter((x) => x !== g) })} data-testid={`svc-aud-${g}`} />
                      {t(`audience.${g}`)}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label>{t("linkedForm")}</Label>
              <Select value={d.formId ?? NONE} onValueChange={(v) => set({ formId: v === NONE ? null : v })}>
                <SelectTrigger className="w-full" data-testid="svc-form">
                  <SelectValue>{form?.label ?? t("noFormOption")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noFormOption")}</SelectItem>
                  {options.forms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("linkedFormHint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("linkedWorkflow")}</Label>
              <Select value={d.workflowId ?? NONE} onValueChange={(v) => set({ workflowId: v === NONE ? null : v })}>
                <SelectTrigger className="w-full" data-testid="svc-workflow">
                  <SelectValue>{workflow?.label ?? t("noWorkflowOption")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noWorkflowOption")}</SelectItem>
                  {options.workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("linkedWorkflowHint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("sensitivity")}</Label>
              {protectedSens ? (
                <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 size-4 shrink-0" />
                  {t("sensitivityLocked", { level: ts(`sensitivity.${d.sensitivity}`) })}
                </p>
              ) : (
                <Select value={d.sensitivity} onValueChange={(v) => set({ sensitivity: v as Sensitivity })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{d.sensitivity === "STANDARD" ? t("standard") : ts(`sensitivity.${d.sensitivity}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STANDARD">{t("standard")}</SelectItem>
                    <SelectItem value="CONFIDENTIAL">{ts("sensitivity.CONFIDENTIAL")}</SelectItem>
                    <SelectItem value="MEDICAL">{ts("sensitivity.MEDICAL")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <Label htmlFor="svc-featured" className="text-sm font-medium">
                    {t("featuredLabel")}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t("featuredHint")}</p>
                </div>
                <Switch id="svc-featured" checked={d.isFeatured} onCheckedChange={(v) => set({ isFeatured: v })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <Label htmlFor="svc-student" className="text-sm font-medium">
                    {t("requiresStudent")}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t("requiresStudentHint")}</p>
                </div>
                <Switch id="svc-student" checked={d.requiresStudent} onCheckedChange={(v) => set({ requiresStudent: v })} />
              </div>
            </div>
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending} data-testid="svc-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {isNew ? t("create") : t("save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
