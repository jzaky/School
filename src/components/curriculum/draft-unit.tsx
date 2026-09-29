"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { acceptUnitAction, discardAiDraftAction, draftUnitAction } from "@/server/curriculum/actions";
import type { ProposedLesson } from "@/server/curriculum/drafter";
import { sessionTimeline } from "@/server/curriculum/types";
import { SimpleSelect, useCurriculumError } from "./fields";

type Std = { id: string; code: string; text: string; strand: string };

export function DraftUnitDialog({ frameworkId, standards, classes, defaultClassId, terms }: { frameworkId: string; standards: Std[]; classes: Array<{ id: string; label: string }>; defaultClassId: string | null; terms: Array<{ id: string; label: string }> }) {
  const t = useTranslations("curriculum.unit");
  const tc = useTranslations("curriculum");
  const locale = useLocale();
  const err = useCurriculumError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>(standards.map((s) => s.id));
  const [duration, setDuration] = useState("50");
  const [maxLessons, setMaxLessons] = useState("6");
  const [classId, setClassId] = useState(defaultClassId ?? "");
  const [termId, setTermId] = useState("");
  const [startWeek, setStartWeek] = useState("");
  const [draft, setDraft] = useState<{ lessons: ProposedLesson[]; interactionId: string; provider: string } | null>(null);
  const ar = locale === "ar";
  const code = (id: string) => standards.find((s) => s.id === id)?.code ?? "";

  const toggle = (id: string, on: boolean) => setSelected((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  const generate = () =>
    start(async () => {
      const res = await draftUnitAction({ frameworkId, standardIds: selected, durationMin: Number(duration), maxLessons: Number(maxLessons) });
      if (!res.ok) return void toast.error(err(res.error));
      setDraft({ lessons: res.lessons, interactionId: res.interactionId, provider: res.provider });
    });

  const accept = () =>
    start(async () => {
      if (!draft) return;
      const res = await acceptUnitAction({ frameworkId, classId: classId || null, termId: termId || null, startWeek: startWeek ? Number(startWeek) : null, lessons: draft.lessons, interactionId: draft.interactionId });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("created", { count: res.ids.length }));
      setOpen(false);
      setDraft(null);
      router.push("/curriculum/plans?status=DRAFT");
    });

  const discard = () =>
    start(async () => {
      if (draft) await discardAiDraftAction(draft.interactionId);
      setDraft(null);
    });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="draft-unit">
        <Sparkles className="size-4" />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft ? t("reviewTitle", { count: draft.lessons.length }) : t("title")}</DialogTitle>
            <DialogDescription>{draft ? t("reviewBody") : t("body")}</DialogDescription>
          </DialogHeader>
          {!draft ? (
            <div className="space-y-4">
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                {standards.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-muted/50">
                    <Checkbox checked={selected.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} className="mt-0.5" />
                    <span className="min-w-0 text-sm">
                      <span className="me-1.5 font-mono text-xs text-muted-foreground" dir="ltr">
                        {s.code}
                      </span>
                      {s.text}
                    </span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="unit-duration">{t("duration")}</Label>
                  <Input id="unit-duration" type="number" min={20} max={120} value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="unit-max">{t("maxLessons")}</Label>
                  <Input id="unit-max" type="number" min={1} max={16} value={maxLessons} onChange={(e) => setMaxLessons(e.target.value)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs">{t("draftNotice")}</p>
              <ol className="space-y-3" data-testid="unit-preview">
                {draft.lessons.map((l, i) => (
                  <li key={i} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {t("lessonN", { n: i + 1 })}: {ar ? l.titleAr : l.titleEn}
                      </h3>
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {l.standardIds.map(code).join(", ")}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{ar ? l.objectivesAr : l.objectivesEn}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs font-medium">{t("mainPoints")}</div>
                        <ul className="list-disc space-y-0.5 ps-5 text-xs">
                          {(ar ? l.mainPointsAr : l.mainPointsEn).map((p, k) => (
                            <li key={k}>{p}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium">{tc("plan.session")}</div>
                        <ul className="space-y-0.5 text-xs">
                          {sessionTimeline(l.activities).map((a, k) => (
                            <li key={k} className="flex gap-2">
                              <span className="shrink-0 tabular-nums text-muted-foreground" dir="ltr">
                                {a.start}-{a.end}
                              </span>
                              <span>{ar ? a.titleAr : a.titleEn}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {tc("plan.materials")}: {l.materials.map((m) => (ar ? m.ar : m.en)).join(ar ? "، " : ", ")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {tc("plan.assessment")}: {ar ? l.assessmentAr : l.assessmentEn}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{tc("plan.class")}</Label>
                  <SimpleSelect options={classes.map((c) => ({ value: c.id, label: c.label }))} value={classId} onChange={setClassId} noneLabel={tc("plan.noClass")} />
                </div>
                <div className="space-y-1.5">
                  <Label>{tc("plan.term")}</Label>
                  <SimpleSelect options={terms.map((c) => ({ value: c.id, label: c.label }))} value={termId} onChange={setTermId} noneLabel={tc("plan.noTerm")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="unit-week">{t("startWeek")}</Label>
                  <Input id="unit-week" type="number" min={1} max={40} value={startWeek} onChange={(e) => setStartWeek(e.target.value)} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {!draft ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button onClick={generate} disabled={pending || !selected.length} data-testid="draft-unit-generate">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {pending ? t("drafting") : t("generate")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={discard} disabled={pending}>
                  {t("discard")}
                </Button>
                <Button onClick={accept} disabled={pending} data-testid="draft-unit-accept">
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("accept", { count: draft.lessons.length })}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
