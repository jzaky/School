"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Check, Loader2, Lock, LockOpen, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/app/badges";
import { Panel, PanelHeader } from "@/components/app/panel";
import {
  approvePlanAction,
  generatePlanAction,
  planSummaryAction,
  requestPlanChangesAction,
  savePlanItemsAction,
  submitPlanAction,
  whatIfAction,
  type PlanSummary,
  type WhatIfRow,
} from "@/server/pathway-engine/actions";
import type { MatchStatus } from "@/server/pathway-engine/types";
import { subjectList, type SubjectNames, type Tr } from "./labels";
import { StatusChip } from "./ui";

type Opt = { value: string; label: string };
const GRADES = [9, 10, 11, 12];

function useErr() {
  const t = useTranslations("engine.errors");
  return (code: string): void => {
    toast.error(t.has(code) ? t(code) : t("generic"));
  };
}

// ---------------------------------------------------------------------------------------------
// Goal

export function GoalForm({ studentId, careers, countries, initial, planHref, hasPlan }: { studentId: string; careers: Opt[]; countries: Opt[]; initial: { careerKey: string | null; countries: string[] }; planHref: string; hasPlan: boolean }) {
  const t = useTranslations("engine.goal");
  const err = useErr();
  const router = useRouter();
  const [career, setCareer] = useState(initial.careerKey ?? "");
  const [picked, setPicked] = useState<string[]>(initial.countries);
  const [pending, start] = useTransition();
  const toggle = (c: string) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const generate = () =>
    start(async () => {
      const res = await generatePlanAction({ studentId, careerKey: career || null, fieldKeys: [], countries: picked });
      if (!res.ok) return err(res.error);
      toast.success(t("generated", { n: res.items }));
      router.push(planHref);
    });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("career")}</Label>
          <Select value={career} onValueChange={setCareer}>
            <SelectTrigger className="w-full" data-testid="goal-career">
              <SelectValue placeholder={t("chooseCareer")} />
            </SelectTrigger>
            <SelectContent>
              {careers.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">{t("countries")}</Label>
          <div className="flex flex-wrap gap-1.5" data-testid="goal-countries">
            {countries.map((c) => {
              const on = picked.includes(c.value);
              return (
                <button key={c.value} type="button" onClick={() => toggle(c.value)} aria-pressed={on} className={cn("rounded-full border px-2.5 py-1 text-xs transition", on ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted")}>
                  {on && <Check className="me-1 inline size-3" />}
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={generate} disabled={pending || !career} data-testid="generate-plan">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          {hasPlan ? t("regenerate") : t("generate")}
        </Button>
        <span className="text-xs text-muted-foreground">{hasPlan ? t("regenerateHint") : t("generateHint")}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Plan builder

type PlanItem = { id: string; gradeLevel: number; schoolCourseId: string | null; name: string; reason: string | null; locked: boolean };
type PlanData = { id: string; status: "DRAFT" | "PROPOSED" | "APPROVED" | "ARCHIVED"; counselorNote: string | null; approvedLine: string | null; proposedLine: string | null; items: PlanItem[] };

export function PlanBuilder({
  studentId,
  studentGrade,
  plan,
  goal,
  record,
  catalog,
  canEdit,
  canApprove,
  isStudent,
}: {
  studentId: string;
  studentGrade: number;
  plan: PlanData | null;
  goal: { careerKey: string | null; fieldKeys: string[]; countries: string[] };
  record: Array<{ id: string; name: string; gradeLevel: number; status: string; grade: string | null }>;
  catalog: Array<{ id: string; name: string; gradeLevels: number[] }>;
  canEdit: boolean;
  canApprove: boolean;
  isStudent: boolean;
}) {
  const t = useTranslations("engine.plan");
  const ts = useTranslations("engine");
  const err = useErr();
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[]>(plan?.items ?? []);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    setItems(plan?.items ?? []);
    setDirty(false);
  }, [plan]);

  const editable = canEdit && !!plan && !(isStudent && plan.status === "PROPOSED");
  const change = (next: PlanItem[]) => {
    setItems(next);
    setDirty(true);
  };
  const byGrade = (g: number) => items.filter((i) => i.gradeLevel === g);
  const save = async () => {
    if (!plan) return false;
    const res = await savePlanItemsAction({ planId: plan.id, items: items.filter((i) => i.schoolCourseId).map((i) => ({ schoolCourseId: i.schoolCourseId!, gradeLevel: i.gradeLevel, locked: i.locked })) });
    if (!res.ok) {
      err(res.error);
      return false;
    }
    setDirty(false);
    return true;
  };
  const act = (fn: () => Promise<boolean | void>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res === false) return;
      toast.success(t(ok));
      router.refresh();
    });

  if (!plan) {
    return (
      <Panel>
        <PanelHeader title={t("title")} description={t("none")} />
        {canEdit ? (
          goal.careerKey || goal.fieldKeys.length ? (
            <Button
              onClick={() =>
                act(async () => {
                  const res = await generatePlanAction({ studentId, careerKey: goal.careerKey, fieldKeys: goal.fieldKeys, countries: goal.countries });
                  if (!res.ok) {
                    err(res.error);
                    return false;
                  }
                }, "generated")
              }
              disabled={pending}
              data-testid="create-plan"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {t("create")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("needGoal")}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">{t("noneView")}</p>
        )}
      </Panel>
    );
  }

  const statusTone = plan.status === "APPROVED" ? "success" : plan.status === "PROPOSED" ? "warning" : "neutral";
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <Pill tone={statusTone} dot>
                <span data-testid="plan-status">{ts(`planStatus.${plan.status}`)}</span>
              </Pill>
              {dirty && <Pill tone="info">{t("dirty")}</Pill>}
            </div>
            <p className="text-xs text-muted-foreground">{plan.approvedLine ?? plan.proposedLine ?? t(`statusHint.${plan.status}`)}</p>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  act(async () => {
                    const res = await generatePlanAction({ studentId, careerKey: goal.careerKey, fieldKeys: goal.fieldKeys, countries: goal.countries });
                    if (!res.ok) {
                      err(res.error);
                      return false;
                    }
                  }, "generated")
                }
                data-testid="regenerate-plan"
              >
                <Wand2 className="size-4" />
                {t("regenerate")}
              </Button>
              <Button variant="outline" size="sm" disabled={pending || !dirty} onClick={() => act(save, "saved")} data-testid="save-plan">
                {t("save")}
              </Button>
              {plan.status === "DRAFT" && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    act(async () => {
                      if (dirty && !(await save())) return false;
                      const res = await submitPlanAction(plan.id);
                      if (!res.ok) {
                        err(res.error);
                        return false;
                      }
                    }, "submitted")
                  }
                  data-testid="submit-plan"
                >
                  {t("submit")}
                </Button>
              )}
            </div>
          )}
        </div>
        {plan.counselorNote && (
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="counselor-note">
            <span className="font-medium">{t("counselorNote")}: </span>
            {plan.counselorNote}
          </p>
        )}
        {!canEdit && <p className="mt-3 text-xs text-muted-foreground">{t("readOnly")}</p>}
        {canEdit && isStudent && plan.status === "PROPOSED" && <p className="mt-3 text-xs text-muted-foreground">{t("waiting")}</p>}
      </Panel>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0" data-testid="plan-grid">
        {GRADES.map((g) => {
          const rec = record.filter((r) => r.gradeLevel === g);
          const planned = byGrade(g);
          const options = catalog.filter((c) => c.gradeLevels.includes(g) && !planned.some((p) => p.schoolCourseId === c.id));
          return (
            <section key={g} className={cn("rounded-xl border bg-card p-3 shadow-xs", g < studentGrade && "bg-muted/30")} data-testid={`plan-grade-${g}`}>
              <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
                {t("grade", { grade: g })}
                <span className="text-xs font-normal text-muted-foreground">{t("coursesN", { n: rec.length + planned.length })}</span>
              </h3>
              <ul className="space-y-2">
                {rec.map((r) => (
                  <li key={r.id} className="rounded-lg border border-dashed px-2.5 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 font-medium">{r.name}</span>
                      {r.grade && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.grade}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{t(`record.${r.status}`)}</div>
                  </li>
                ))}
                {planned.map((i) => (
                  <li key={i.id} className="rounded-lg border px-2.5 py-2 text-sm" data-testid="plan-item">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 font-medium">{i.name}</span>
                      {editable && i.schoolCourseId ? (
                        <span className="flex shrink-0 gap-0.5">
                          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={i.locked ? t("unlock") : t("lock")} title={i.locked ? t("unlock") : t("lock")} onClick={() => change(items.map((x) => (x.id === i.id ? { ...x, locked: !x.locked } : x)))}>
                            {i.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("remove")} title={t("remove")} onClick={() => change(items.filter((x) => x.id !== i.id))}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </span>
                      ) : (
                        i.locked && <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("locked")} />
                      )}
                    </div>
                    {i.reason && <p className="mt-1 text-xs text-muted-foreground">{i.reason}</p>}
                  </li>
                ))}
                {rec.length + planned.length === 0 && <li className="text-xs text-muted-foreground">{g < studentGrade ? t("pastEmpty") : t("gradeEmpty")}</li>}
              </ul>
              {editable && g >= studentGrade && options.length > 0 && (
                <Select
                  value=""
                  onValueChange={(v) => {
                    const c = catalog.find((x) => x.id === v);
                    if (c) change([...items, { id: `new-${c.id}-${g}`, gradeLevel: g, schoolCourseId: c.id, name: c.name, reason: t("addedByHand"), locked: false }]);
                  }}
                >
                  <SelectTrigger size="sm" className="mt-2 w-full" data-testid={`add-course-${g}`}>
                    <Plus className="size-3.5" />
                    <SelectValue placeholder={t("add")} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </section>
          );
        })}
      </div>

      {canApprove && plan.status !== "APPROVED" && (
        <Panel>
          <PanelHeader title={t("review.title")} description={plan.status === "PROPOSED" ? t("review.desc") : t("review.descDraft")} />
          <div className="space-y-2">
            <Label htmlFor="plan-note" className="text-xs text-muted-foreground">
              {t("review.note")}
            </Label>
            <Textarea id="plan-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("review.notePlaceholder")} rows={3} data-testid="plan-note" />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending || dirty}
                title={dirty ? t("review.saveFirst") : undefined}
                onClick={() =>
                  act(async () => {
                    const res = await approvePlanAction({ planId: plan.id, note: note || null });
                    if (!res.ok) {
                      err(res.error);
                      return false;
                    }
                    setNote("");
                  }, "approved")
                }
                data-testid="approve-plan"
              >
                <Check className="size-4" />
                {t("review.approve")}
              </Button>
              {plan.status === "PROPOSED" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !note.trim()}
                  title={!note.trim() ? t("review.noteRequired") : undefined}
                  onClick={() =>
                    act(async () => {
                      const res = await requestPlanChangesAction({ planId: plan.id, note });
                      if (!res.ok) {
                        err(res.error);
                        return false;
                      }
                      setNote("");
                    }, "changesRequested")
                  }
                  data-testid="request-changes"
                >
                  <X className="size-4" />
                  {t("review.requestChanges")}
                </Button>
              )}
            </div>
            {dirty && <p className="text-xs text-muted-foreground">{t("review.saveFirst")}</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// What-if

type Change =
  | { type: "add_course"; schoolCourseId: string; gradeLevel: number; predictedGrade: string | null; label: string }
  | { type: "drop_course"; courseRef: string; label: string }
  | { type: "set_grade"; courseRef: string; predictedGrade: string | null; label: string }
  | { type: "set_test"; kind: string; score: number; label: string };

const TESTS = ["IELTS", "TOEFL", "DUOLINGO", "SAT", "ACT", "UCAT", "TMUA", "LNAT", "EMSAT_ENGLISH", "EMSAT_MATH"];

export function WhatIfPanel({
  studentId,
  planId,
  locale,
  names,
  courses,
  catalog,
  tests,
  programHrefBase,
  studentQuery,
}: {
  studentId: string;
  planId: string | null;
  locale: string;
  names: SubjectNames;
  courses: Array<{ ref: string; name: string; status: string; gradeLevel: number; grade: string | null; options: string[] }>;
  catalog: Array<{ id: string; name: string; gradeLevels: number[]; options: string[] }>;
  tests: Array<{ kind: string; score: number }>;
  programHrefBase: string;
  studentQuery: string;
}) {
  const t = useTranslations("engine.whatIf");
  const te = useTranslations("engine") as unknown as Tr;
  const err = useErr();
  const [changes, setChanges] = useState<Change[]>([]);
  const [rows, setRows] = useState<WhatIfRow[] | null>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Change["type"]>("add_course");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");

  useEffect(() => {
    start(async () => {
      const res = await whatIfAction({ studentId, planId, changes: changes.map(({ label: _label, ...x }) => x) });
      if (!res.ok) return err(res.error);
      setRows(res.rows);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes]);

  const reset = () => {
    setA("");
    setB("");
    setC("");
  };
  const add = () => {
    if (mode === "add_course") {
      const course = catalog.find((x) => x.id === a);
      if (!course) return;
      const grade = Number(b) || course.gradeLevels[0];
      setChanges((p) => [...p, { type: "add_course", schoolCourseId: course.id, gradeLevel: grade, predictedGrade: c || null, label: t("label.add", { course: course.name, grade }) }]);
    } else if (mode === "drop_course") {
      const course = courses.find((x) => x.ref === a);
      if (!course) return;
      setChanges((p) => [...p, { type: "drop_course", courseRef: course.ref, label: t("label.drop", { course: course.name }) }]);
    } else if (mode === "set_grade") {
      const course = courses.find((x) => x.ref === a);
      if (!course || !b) return;
      setChanges((p) => [...p, { type: "set_grade", courseRef: course.ref, predictedGrade: b, label: t("label.grade", { course: course.name, grade: b }) }]);
    } else {
      const score = Number(b);
      if (!a || !Number.isFinite(score) || b === "") return;
      setChanges((p) => [...p.filter((x) => !(x.type === "set_test" && x.kind === a)), { type: "set_test", kind: a, score, label: t("label.test", { test: a.replace(/_/g, " "), score: b }) }]);
    }
    reset();
  };
  const addCourse = catalog.find((x) => x.id === a);
  const gradeCourse = courses.find((x) => x.ref === a);
  const shown = useMemo(() => (rows ?? []).slice().sort((x, y) => Math.abs(y.direction) - Math.abs(x.direction) || y.changed.length - x.changed.length), [rows]);
  const changedCount = (rows ?? []).filter((r) => r.direction !== 0 || r.changed.length > 0).length;

  return (
    <div className="grid gap-4 lg:grid-cols-5 [&>*]:min-w-0">
      <Panel className="lg:col-span-2">
        <PanelHeader title={t("title")} description={t("desc")} />
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1.5" role="tablist">
            {(["add_course", "drop_course", "set_grade", "set_test"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  reset();
                }}
                className={cn("rounded-lg border px-2 py-1.5 text-xs", mode === m ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted")}
                data-testid={`whatif-mode-${m}`}
              >
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>

          {(mode === "add_course" || mode === "drop_course" || mode === "set_grade") && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("course")}</Label>
              <Select value={a} onValueChange={(v) => { setA(v); setB(""); setC(""); }}>
                <SelectTrigger className="w-full" data-testid="whatif-course">
                  <SelectValue placeholder={t("chooseCourse")} />
                </SelectTrigger>
                <SelectContent>
                  {(mode === "add_course" ? catalog.map((x) => ({ value: x.id, label: x.name })) : courses.filter((x) => mode === "drop_course" || x.options.length > 0).map((x) => ({ value: x.ref, label: `${x.name} (${t("gradeN", { grade: x.gradeLevel })})` }))).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === "add_course" && addCourse && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("gradeLevel")}</Label>
                <Select value={b || String(addCourse.gradeLevels[0])} onValueChange={setB}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {addCourse.gradeLevels.map((g) => (
                      <SelectItem key={g} value={String(g)}>
                        {t("gradeN", { grade: g })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("predicted")}</Label>
                <Select value={c || "none"} onValueChange={(v) => setC(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full" data-testid="whatif-predicted">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("noGrade")}</SelectItem>
                    {addCourse.options.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {mode === "set_grade" && gradeCourse && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("newGrade")}</Label>
              <Select value={b} onValueChange={setB}>
                <SelectTrigger className="w-full" data-testid="whatif-grade">
                  <SelectValue placeholder={gradeCourse.grade ? t("currentGrade", { grade: gradeCourse.grade }) : t("chooseGrade")} />
                </SelectTrigger>
                <SelectContent>
                  {gradeCourse.options.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === "set_test" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("test")}</Label>
                <Select value={a} onValueChange={setA}>
                  <SelectTrigger className="w-full" data-testid="whatif-test">
                    <SelectValue placeholder={t("chooseTest")} />
                  </SelectTrigger>
                  <SelectContent>
                    {TESTS.map((x) => (
                      <SelectItem key={x} value={x}>
                        {x.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="whatif-score" className="text-xs text-muted-foreground">
                  {t("score")}
                </Label>
                <Input id="whatif-score" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value.replace(/[^\d.]/g, ""))} placeholder={tests.find((x) => x.kind === a)?.score.toString() ?? ""} data-testid="whatif-score" />
              </div>
            </div>
          )}
          <Button size="sm" onClick={add} disabled={!a || (mode === "set_grade" && !b) || (mode === "set_test" && !b)} data-testid="whatif-add">
            <Plus className="size-4" />
            {t("addChange")}
          </Button>

          <div className="border-t pt-3">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>{t("changes")}</span>
              {changes.length > 0 && (
                <button type="button" className="text-brand hover:underline" onClick={() => setChanges([])}>
                  {t("clear")}
                </button>
              )}
            </div>
            {changes.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noChanges")}</p>
            ) : (
              <ul className="space-y-1.5" data-testid="whatif-changes">
                {changes.map((ch, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                    <span className="min-w-0">{ch.label}</span>
                    <button type="button" aria-label={t("removeChange")} className="text-muted-foreground hover:text-foreground" onClick={() => setChanges((p) => p.filter((_, j) => j !== i))}>
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <Panel className="lg:col-span-3">
        <PanelHeader title={t("results")} description={changes.length ? t("resultsDesc", { n: changedCount }) : t("resultsIdle")} action={pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : undefined} />
        {rows === null ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noPrograms")}</p>
        ) : (
          <ul className={cn("divide-y", pending && "opacity-60")} data-testid="whatif-results">
            {shown.map((r) => (
              <li key={r.programId} className="py-2.5" data-testid="whatif-row" data-direction={r.direction}>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <Link href={`${programHrefBase}${r.programId}${studentQuery}`} className="min-w-0 flex-1 hover:text-brand">
                    <div className="truncate text-sm font-medium">{locale === "ar" ? r.nameAr : r.nameEn}</div>
                    <div className="truncate text-xs text-muted-foreground">{locale === "ar" ? r.uniAr : r.uniEn}</div>
                  </Link>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <StatusChip status={r.before as MatchStatus} />
                    {r.direction !== 0 && (
                      <>
                        <ArrowRight className="size-3.5 text-muted-foreground rtl:rotate-180" />
                        <StatusChip status={r.after as MatchStatus} />
                      </>
                    )}
                  </div>
                </div>
                {r.changed.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                    {r.changed.slice(0, 4).map((c, i) => (
                      <li key={i}>
                        {t("lineChange", {
                          what: c.kind === "subject" ? subjectList(c.keys, names, locale, te) : c.kind === "language" || c.kind === "test" ? (c.keys?.[0] ?? "").replace(/_/g, " ") : te(`kind.${c.kind}`),
                          before: te(`lineStatus.${c.before}`),
                          after: te(`lineStatus.${c.after}`),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// AI narrative (draft)

export function AiSummary({ studentId }: { studentId: string }) {
  const t = useTranslations("engine.aiSummary");
  const err = useErr();
  const [out, setOut] = useState<PlanSummary | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("title")}</div>
          <p className="text-xs text-muted-foreground">{t("desc")}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await planSummaryAction(studentId);
              if (!res.ok) return err(res.error);
              setOut(res.summary);
            })
          }
          data-testid="ai-summary"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {out ? t("again") : t("button")}
        </Button>
      </div>
      {out && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm" data-testid="ai-summary-text">
          <Pill tone="violet">{t("draft")}</Pill>
          <p className="mt-2">{out.summary}</p>
          {out.steps.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 ps-5 text-muted-foreground">
              {out.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
