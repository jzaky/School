"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel, PanelHeader } from "@/components/app/panel";
import { savePlanAction, type PlanInput } from "@/server/curriculum/actions";
import { PHASES, totalMinutes, type Activity, type Phase } from "@/server/curriculum/types";
import { SimpleSelect, useCurriculumError } from "./fields";

export type EditorOptions = {
  combos: Array<{ subjectId: string; grade: number; label: string }>;
  classes: Array<{ id: string; subjectId: string; grade: number; label: string }>;
  terms: Array<{ id: string; label: string }>;
  standards: Array<{ id: string; subjectId: string; grade: number; framework: string; code: string; strand: string; text: string; count: number }>;
};

type Lang = "en" | "ar";

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const t = useTranslations("curriculum.editor");
  return (
    <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label={t("editLanguage")}>
      {(["en", "ar"] as const).map((l) => (
        <button key={l} type="button" onClick={() => onChange(l)} className={cn("rounded-md px-2.5 py-1 font-medium", lang === l ? "bg-card shadow-xs" : "text-muted-foreground")} data-testid={`lang-${l}`}>
          {t(l === "en" ? "english" : "arabic")}
        </button>
      ))}
    </div>
  );
}

export function PlanEditor({ initial, options }: { initial: PlanInput; options: EditorOptions }) {
  const t = useTranslations("curriculum");
  const err = useCurriculumError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [p, setP] = useState<PlanInput>(initial);
  const [lang, setLang] = useState<Lang>("en");
  const [query, setQuery] = useState("");
  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setP((cur) => ({ ...cur, [k]: v }));
  const L = lang === "en" ? "En" : "Ar";
  const dir = lang === "ar" ? "rtl" : "ltr";

  const comboKey = p.subjectId ? `${p.subjectId}:${p.gradeLevel}` : "";
  const classes = options.classes.filter((c) => c.subjectId === p.subjectId && c.grade === p.gradeLevel);
  const standards = options.standards.filter((s) => s.subjectId === p.subjectId && s.grade === p.gradeLevel);
  const q = query.trim().toLowerCase();
  const shown = q ? standards.filter((s) => `${s.code} ${s.text} ${s.strand}`.toLowerCase().includes(q)) : standards;
  const groups = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const s of shown) m.set(`${s.framework} · ${s.strand}`, [...(m.get(`${s.framework} · ${s.strand}`) ?? []), s]);
    return [...m.entries()];
  }, [shown]);
  const minutes = totalMinutes(p.activities);

  const setActivity = (i: number, patch: Partial<Activity>) => set("activities", p.activities.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...p.activities];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set("activities", next);
  };

  const save = () =>
    start(async () => {
      const res = await savePlanAction(p);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("editor.saved"));
      router.push(`/curriculum/plans/${res.id}`);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title={t("editor.basics")} />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="plan-title-en">{t("editor.titleEn")}</Label>
            <Input id="plan-title-en" dir="ltr" value={p.titleEn} onChange={(e) => set("titleEn", e.target.value)} data-testid="plan-title-en" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-title-ar">{t("editor.titleAr")}</Label>
            <Input id="plan-title-ar" dir="rtl" value={p.titleAr} onChange={(e) => set("titleAr", e.target.value)} data-testid="plan-title-ar" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("editor.subjectGrade")}</Label>
            <SimpleSelect
              testId="plan-subject"
              options={options.combos.map((c) => ({ value: `${c.subjectId}:${c.grade}`, label: c.label }))}
              value={comboKey}
              placeholder={t("editor.chooseSubject")}
              onChange={(v) => {
                const [subjectId, g] = v.split(":");
                setP((cur) => ({ ...cur, subjectId, gradeLevel: Number(g), classId: null, standardIds: [] }));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("plan.class")}</Label>
            <SimpleSelect options={classes.map((c) => ({ value: c.id, label: c.label }))} value={p.classId ?? ""} onChange={(v) => set("classId", v || null)} noneLabel={t("plan.noClass")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("plan.term")}</Label>
              <SimpleSelect options={options.terms.map((c) => ({ value: c.id, label: c.label }))} value={p.termId ?? ""} onChange={(v) => set("termId", v || null)} noneLabel={t("plan.noTerm")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-week">{t("plan.week")}</Label>
              <Input id="plan-week" type="number" min={1} max={60} value={p.weekNo ?? ""} onChange={(e) => set("weekNo", e.target.value ? Number(e.target.value) : null)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-date">{t("plan.date")}</Label>
              <Input id="plan-date" type="date" value={p.plannedFor ?? ""} onChange={(e) => set("plannedFor", e.target.value || null)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-duration">{t("plan.duration")}</Label>
              <Input id="plan-duration" type="number" min={10} max={240} value={p.durationMin} onChange={(e) => set("durationMin", Number(e.target.value))} />
            </div>
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">{t("editor.languageHint")}</p>
        <LangToggle lang={lang} onChange={setLang} />
      </div>

      <Panel>
        <PanelHeader title={t("plan.objectives")} description={t("editor.objectivesHint")} />
        <Textarea dir={dir} rows={4} value={(p[`objectives${L}`] as string) ?? ""} onChange={(e) => set(`objectives${L}`, e.target.value)} data-testid="plan-objectives" />
      </Panel>

      <Panel>
        <PanelHeader
          title={t("plan.session")}
          description={t("editor.sessionHint")}
          action={<span className={cn("rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", minutes === p.durationMin ? "bg-success-soft text-success" : "bg-warning-soft")}>{t("editor.minutesOf", { minutes, total: p.durationMin })}</span>}
        />
        <div className="space-y-3">
          {p.activities.map((a, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3" data-testid="activity-row">
              <div className="grid gap-2 sm:grid-cols-[140px_100px_minmax(0,1fr)_auto] sm:items-center">
                <SimpleSelect options={PHASES.map((ph) => ({ value: ph, label: t(`phase.${ph}`) }))} value={a.phase} onChange={(v) => setActivity(i, { phase: v as Phase })} />
                <div className="relative">
                  <Input type="number" min={0} max={240} value={a.minutes} onChange={(e) => setActivity(i, { minutes: Number(e.target.value) })} aria-label={t("editor.minutes")} className="pe-12" />
                  <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t("editor.min")}</span>
                </div>
                <Input dir={dir} value={a[`title${L}`]} onChange={(e) => setActivity(i, { [`title${L}`]: e.target.value })} placeholder={t("editor.activityTitle")} />
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("editor.moveUp")}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === p.activities.length - 1} aria-label={t("editor.moveDown")}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => set("activities", p.activities.filter((_, k) => k !== i))} aria-label={t("editor.removeActivity")}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <Textarea dir={dir} rows={2} value={a[`detail${L}`]} onChange={(e) => setActivity(i, { [`detail${L}`]: e.target.value })} placeholder={t("editor.activityDetail")} />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => set("activities", [...p.activities, { phase: "main", minutes: 10, titleEn: "", titleAr: "", detailEn: "", detailAr: "" }])} data-testid="add-activity">
            <Plus className="size-4" />
            {t("editor.addActivity")}
          </Button>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t("plan.materials")} />
          <div className="space-y-2">
            {p.materials.map((m, i) => (
              <div key={i} className="flex gap-2">
                <Input dir={dir} value={m[lang]} onChange={(e) => set("materials", p.materials.map((x, k) => (k === i ? { ...x, [lang]: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" onClick={() => set("materials", p.materials.filter((_, k) => k !== i))} aria-label={t("editor.removeMaterial")}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set("materials", [...p.materials, { en: "", ar: "" }])}>
              <Plus className="size-4" />
              {t("editor.addMaterial")}
            </Button>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("plan.assessment")} description={t("editor.assessmentHint")} />
          <Textarea dir={dir} rows={3} value={(p[`assessment${L}`] as string) ?? ""} onChange={(e) => set(`assessment${L}`, e.target.value)} />
          <div className="mt-4 mb-1.5 text-sm font-semibold">{t("plan.differentiation")}</div>
          <Textarea dir={dir} rows={3} value={p.differentiation[lang]} onChange={(e) => set("differentiation", { ...p.differentiation, [lang]: e.target.value })} placeholder={t("editor.differentiationHint")} />
        </Panel>
      </div>

      <Panel>
        <PanelHeader title={t("plan.standards")} description={t("editor.standardsHint", { count: p.standardIds.length })} />
        {!p.subjectId ? (
          <p className="text-sm text-muted-foreground">{t("editor.pickSubjectFirst")}</p>
        ) : standards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("editor.noStandards")}</p>
        ) : (
          <>
            <div className="relative mb-3 max-w-sm">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("editor.searchStandards")} className="ps-9" />
            </div>
            <div className="max-h-[420px] space-y-4 overflow-y-auto">
              {groups.map(([group, list]) => (
                <div key={group}>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{group}</div>
                  <div className="space-y-0.5">
                    {list.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-muted/50" data-testid="standard-option">
                        <Checkbox checked={p.standardIds.includes(s.id)} onCheckedChange={(v) => set("standardIds", v === true ? [...p.standardIds, s.id] : p.standardIds.filter((x) => x !== s.id))} className="mt-0.5" />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="me-1.5 font-mono text-xs text-muted-foreground" dir="ltr">
                            {s.code}
                          </span>
                          {s.text}
                        </span>
                        <span className={cn("shrink-0 rounded-full px-1.5 text-[11px]", s.count === 0 ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground")}>{s.count === 0 ? t("coverage.state.missing") : t("editor.plannedN", { count: s.count })}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t bg-background/95 py-3 ps-4 pe-36 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={pending} data-testid="plan-save">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("editor.save")}
        </Button>
      </div>
    </div>
  );
}
