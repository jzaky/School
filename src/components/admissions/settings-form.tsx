"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel, PanelHeader } from "@/components/app/panel";
import { saveSettingsAction } from "@/server/admissions/actions";
import { DOC_CATEGORIES, type DocType } from "@/server/admissions/config";
import { formatAdmissionNo, patternProblem } from "@/server/admissions/numbers";
import { AUTHORITIES } from "@/server/admissions/registration";
import { OPTIONAL_STAGES } from "@/server/admissions/stages";
import { CopyLink } from "./copy-link";
import { Field, selectClass } from "./ui";

type StageRow = { key: string; labelEn: string | null; labelAr: string | null; hidden: boolean; custom: boolean; phase: string };
type Initial = {
  publicOpen: boolean;
  openYearIds: string[];
  cutoffMonth: number;
  cutoffDay: number;
  admissionNoPattern: string;
  offerDays: number;
  introEn: string;
  introAr: string;
  authority: string;
  authorityLabelEn: string;
  authorityLabelAr: string;
  stages: StageRow[];
  documentTypes: DocType[];
};

const PRESETS = [
  { key: "dec31", month: 12, day: 31 },
  { key: "mar31", month: 3, day: 31 },
];

export function SettingsForm({ slug, shortName, years, initial }: { slug: string; shortName: string; years: Array<{ value: string; label: string; current: boolean }>; initial: Initial }) {
  const t = useTranslations("admissions.settings");
  const ts = useTranslations("admissions.stage");
  const tg = useTranslations("gradeLevel");
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const preset = PRESETS.find((p) => p.month === v.cutoffMonth && p.day === v.cutoffDay)?.key ?? "custom";
  const problem = patternProblem(v.admissionNoPattern);
  const review = v.stages.filter((s) => s.phase === "review");
  const others = v.stages.filter((s) => s.phase !== "review");
  const setStage = (key: string, patch: Partial<StageRow>) => setV({ ...v, stages: v.stages.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const moveStage = (key: string, dir: -1 | 1) => {
    const list = [...review];
    const i = list.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i <= 0 || j <= 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setV({ ...v, stages: [...list, ...others] });
  };
  const addStage = () => {
    const n = v.stages.filter((s) => s.custom).length + 1;
    const key = `C_STAGE_${Date.now().toString(36).toUpperCase().slice(-5)}${n}`;
    setV({ ...v, stages: [...review, { key, labelEn: "", labelAr: "", hidden: false, custom: true, phase: "review" }, ...others] });
  };
  const setDoc = (i: number, patch: Partial<DocType>) => setV({ ...v, documentTypes: v.documentTypes.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const save = () =>
    start(async () => {
      const r = await saveSettingsAction({
        publicOpen: v.publicOpen,
        openYearIds: v.openYearIds,
        cutoffMonth: v.cutoffMonth,
        cutoffDay: v.cutoffDay,
        admissionNoPattern: v.admissionNoPattern,
        offerDays: v.offerDays,
        introEn: v.introEn,
        introAr: v.introAr,
        authority: v.authority,
        authorityLabelEn: v.authorityLabelEn,
        authorityLabelAr: v.authorityLabelAr,
        stages: v.stages.map((s) => ({ key: s.key, labelEn: s.labelEn || null, labelAr: s.labelAr || null, hidden: s.hidden })),
        documentTypes: v.documentTypes.map((d) => ({ ...d, labelAr: d.labelAr || d.labelEn })),
      });
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(t("saved"));
      router.refresh();
    });

  return (
    <div className="space-y-6 pb-20">
      <Panel>
        <PanelHeader title={t("online")} description={t("onlineHint")} />
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">{t("acceptOnline")}</div>
            <div className="text-xs text-muted-foreground" dir="ltr">
              /apply/{slug}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {initial.publicOpen && <CopyLink path={`/apply/${slug}`} label={t("copy")} />}
            <Switch checked={v.publicOpen} onCheckedChange={(c) => setV({ ...v, publicOpen: c })} aria-label={t("acceptOnline")} data-testid="public-open" />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-sm font-medium">{t("years")}</div>
          <p className="text-xs text-muted-foreground">{t("yearsHint")}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {years.map((y) => (
              <label key={y.value} className="flex items-center gap-2 text-sm">
                <Checkbox checked={v.openYearIds.includes(y.value)} onCheckedChange={(c) => setV({ ...v, openYearIds: c === true ? [...v.openYearIds, y.value] : v.openYearIds.filter((x) => x !== y.value) })} />
                {y.label}
                {y.current && <span className="text-xs text-muted-foreground">({t("currentYear")})</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field id="introEn" label={t("introEn")} optional>
            <Textarea id="introEn" rows={3} maxLength={600} dir="ltr" value={v.introEn} onChange={(e) => setV({ ...v, introEn: e.target.value })} />
          </Field>
          <Field id="introAr" label={t("introAr")} optional>
            <Textarea id="introAr" rows={3} maxLength={600} dir="rtl" value={v.introAr} onChange={(e) => setV({ ...v, introAr: e.target.value })} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={t("ageTitle")} description={t("ageHint")} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="preset" label={t("cutoff")} className="sm:col-span-3">
            <select id="preset" className={selectClass} value={preset} onChange={(e) => {
              const p = PRESETS.find((x) => x.key === e.target.value);
              if (p) setV({ ...v, cutoffMonth: p.month, cutoffDay: p.day });
              else setV({ ...v, cutoffMonth: v.cutoffMonth, cutoffDay: v.cutoffDay === 31 ? 30 : v.cutoffDay });
            }} data-testid="cutoff-preset">
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {t(`preset.${p.key}`)}
                </option>
              ))}
              <option value="custom">{t("preset.custom")}</option>
            </select>
          </Field>
          {preset === "custom" && (
            <>
              <Field id="cm" label={t("month")}>
                <Input id="cm" type="number" min={1} max={12} dir="ltr" value={v.cutoffMonth} onChange={(e) => setV({ ...v, cutoffMonth: Number(e.target.value) })} />
              </Field>
              <Field id="cd" label={t("day")}>
                <Input id="cd" type="number" min={1} max={31} dir="ltr" value={v.cutoffDay} onChange={(e) => setV({ ...v, cutoffDay: Number(e.target.value) })} />
              </Field>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("ageRule")}</p>
      </Panel>

      <Panel>
        <PanelHeader title={t("numbersTitle")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pattern" label={t("pattern")} hint={problem ? undefined : t("patternPreview", { example: formatAdmissionNo(v.admissionNoPattern, { year: new Date().getFullYear() + 1, seq: 42, short: shortName }) })} error={problem ? t(`patternError.${problem}`) : undefined}>
            <Input id="pattern" dir="ltr" value={v.admissionNoPattern} onChange={(e) => setV({ ...v, admissionNoPattern: e.target.value })} aria-invalid={Boolean(problem)} data-testid="pattern" />
          </Field>
          <Field id="offerDays" label={t("offerDays")} hint={t("offerDaysHint")}>
            <Input id="offerDays" type="number" min={1} max={60} dir="ltr" value={v.offerDays} onChange={(e) => setV({ ...v, offerDays: Number(e.target.value) })} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("patternTokens")}</p>
      </Panel>

      <Panel>
        <PanelHeader title={t("authorityTitle")} description={t("authorityHint")} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="authority" label={t("authority")} className="sm:col-span-3">
            <select id="authority" className={selectClass} value={v.authority} onChange={(e) => setV({ ...v, authority: e.target.value })} data-testid="authority">
              {AUTHORITIES.map((a) => (
                <option key={a} value={a}>
                  {t(`authorityOption.${a}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="aLabelEn" label={t("authorityLabelEn")} optional>
            <Input id="aLabelEn" dir="ltr" maxLength={60} value={v.authorityLabelEn} onChange={(e) => setV({ ...v, authorityLabelEn: e.target.value })} />
          </Field>
          <Field id="aLabelAr" label={t("authorityLabelAr")} optional>
            <Input id="aLabelAr" dir="rtl" maxLength={60} value={v.authorityLabelAr} onChange={(e) => setV({ ...v, authorityLabelAr: e.target.value })} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={t("stagesTitle")} description={t("stagesHint")} />
        <ul className="space-y-2" data-testid="stages-editor">
          {[...review, ...others].map((s, i) => {
            const isReview = s.phase === "review";
            return (
              <li key={s.key} className={cn("grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center", s.hidden && "opacity-60")}>
                <div className="text-sm font-medium">{s.custom ? t("customStage") : ts(s.key)}</div>
                <Input dir="ltr" maxLength={40} placeholder={s.custom ? t("labelEnRequired") : t("labelEn")} value={s.labelEn ?? ""} onChange={(e) => setStage(s.key, { labelEn: e.target.value })} className="h-8" aria-label={t("labelEn")} />
                <Input dir="rtl" maxLength={40} placeholder={t("labelAr")} value={s.labelAr ?? ""} onChange={(e) => setStage(s.key, { labelAr: e.target.value })} className="h-8" aria-label={t("labelAr")} />
                <div className="flex items-center justify-end gap-1">
                  {isReview && s.key !== "NEW" && (
                    <>
                      <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i <= 1} onClick={() => moveStage(s.key, -1)} aria-label={t("moveUp")}>
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i >= review.length - 1} onClick={() => moveStage(s.key, 1)} aria-label={t("moveDown")}>
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </>
                  )}
                  {OPTIONAL_STAGES.includes(s.key) && (
                    <label className="flex items-center gap-1.5 text-xs">
                      <Switch checked={!s.hidden} onCheckedChange={(c) => setStage(s.key, { hidden: !c })} aria-label={t("used")} />
                      {t("used")}
                    </label>
                  )}
                  {s.custom && (
                    <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => setV({ ...v, stages: v.stages.filter((x) => x.key !== s.key) })} aria-label={t("remove")}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <Button type="button" size="sm" variant="outline" className="mt-3" disabled={v.stages.filter((s) => s.custom).length >= 6} onClick={addStage} data-testid="add-stage">
          <Plus className="size-4" />
          {t("addStage")}
        </Button>
      </Panel>

      <Panel>
        <PanelHeader title={t("docsTitle")} description={t("docsHint")} />
        <ul className="space-y-2">
          {v.documentTypes.map((d, i) => (
            <li key={`${d.key}-${i}`} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-4 sm:items-center">
              <Input dir="ltr" maxLength={80} value={d.labelEn} onChange={(e) => setDoc(i, { labelEn: e.target.value })} className="h-8 sm:col-span-2" aria-label={t("labelEn")} />
              <Input dir="rtl" maxLength={80} value={d.labelAr} onChange={(e) => setDoc(i, { labelAr: e.target.value })} className="h-8 sm:col-span-2" aria-label={t("labelAr")} />
              <select className={cn(selectClass, "h-8")} value={d.category} onChange={(e) => setDoc(i, { category: e.target.value as DocType["category"] })} aria-label={t("category")}>
                {DOC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`category_${c}`)}
                  </option>
                ))}
              </select>
              <select className={cn(selectClass, "h-8")} value={d.minGrade ?? ""} onChange={(e) => setDoc(i, { minGrade: e.target.value === "" ? null : Number(e.target.value) })} aria-label={t("fromGrade")}>
                <option value="">{t("allGrades")}</option>
                {ALL_GRADE_LEVELS.slice(1).map((g) => (
                  <option key={g} value={g}>
                    {t("fromGradeN", { grade: tg("label", gradeLevelValues(g)) })}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={d.required} onCheckedChange={(c) => setDoc(i, { required: c === true })} />
                  {t("required")}
                </label>
                <label className="flex items-center gap-1.5 text-xs" title={t("notForUaeHint")}>
                  <Checkbox checked={d.exemptNationalities.includes("AE")} onCheckedChange={(c) => setDoc(i, { exemptNationalities: c === true ? [...new Set([...d.exemptNationalities, "AE"])] : d.exemptNationalities.filter((x) => x !== "AE") })} />
                  {t("notForUae")}
                </label>
                <Button type="button" size="icon" variant="ghost" className="size-7" disabled={v.documentTypes.length <= 1} onClick={() => setV({ ...v, documentTypes: v.documentTypes.filter((_, j) => j !== i) })} aria-label={t("remove")}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={v.documentTypes.length >= 20}
          onClick={() => setV({ ...v, documentTypes: [...v.documentTypes, { key: `doc_${Date.now().toString(36)}`, labelEn: "", labelAr: "", required: false, minGrade: null, exemptNationalities: [], category: "identity" }] })}
        >
          <Plus className="size-4" />
          {t("addDoc")}
        </Button>
      </Panel>

      <div className="sticky bottom-0 -mx-4 flex justify-end border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Button disabled={pending || Boolean(problem)} onClick={save} data-testid="save-settings">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
