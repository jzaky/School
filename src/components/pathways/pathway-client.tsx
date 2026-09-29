"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import {
  addProgramToShortlistAction,
  confirmAction,
  deleteResultAction,
  deleteScoreAction,
  pathwayAdviceAction,
  saveResultAction,
  saveScoreAction,
  setCurriculumAction,
  type Advice,
} from "@/server/pathways/actions";

type Opt = { value: string; label: string };

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (entries: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(entries)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`));
  };
  return { set, pending, sp };
}

/** URL-driven select filters for the university and programme browser. */
export function PathwayFilters({ filters }: { filters: Array<{ param: string; label: string; all: string; options: Opt[] }> }) {
  const { set, sp } = useParamSetter();
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" data-testid="pathway-filters">
      {filters.map((f) => (
        <div key={f.param} className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">{f.label}</Label>
          <Select value={sp.get(f.param) ?? "all"} onValueChange={(v) => set({ [f.param]: v === "all" ? null : v, page: null })}>
            <SelectTrigger size="sm" className="w-full" data-testid={`filter-${f.param}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{f.all}</SelectItem>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

/** Parents with several children and advising staff choose whose pathway they are looking at. */
export function StudentPicker({ students, current }: { students: Opt[]; current: string | null }) {
  const t = useTranslations("pathways");
  const { set } = useParamSetter();
  return (
    <Select value={current ?? ""} onValueChange={(v) => set({ student: v })}>
      <SelectTrigger size="sm" className="w-56 max-w-full" data-testid="student-picker">
        <SelectValue placeholder={t("chooseStudent")} />
      </SelectTrigger>
      <SelectContent>
        {students.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AddToShortlistButton({ programId, studentId, inShortlist }: { programId: string; studentId: string; inShortlist: boolean }) {
  const t = useTranslations("pathways");
  const router = useRouter();
  const [pending, start] = useTransition();
  if (inShortlist)
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-success" data-testid="in-shortlist">
        <Check className="size-4" />
        {t("inShortlist")}
      </span>
    );
  return (
    <Button
      size="sm"
      disabled={pending}
      data-testid="add-to-shortlist"
      onClick={() =>
        start(async () => {
          const res = await addProgramToShortlistAction({ programId, studentId });
          if (res.ok) toast.success(t("addedToShortlist"));
          else toast.error(t("error.generic"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      {t("addToShortlist")}
    </Button>
  );
}

export function AdvicePanel({ programId, studentId }: { programId: string; studentId: string }) {
  const t = useTranslations("pathways");
  const [pending, start] = useTransition();
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="advice-panel">
      {!advice && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          data-testid="draft-advice"
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await pathwayAdviceAction({ programId, studentId });
              if (res.ok) setAdvice(res.advice);
              else setError(res.error === "disabled" ? t("advice.disabled") : t("error.generic"));
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t("advice.draft")}
        </Button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {advice && (
        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm" data-testid="advice-draft">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="violet">{t("advice.badge")}</Pill>
            <span className="text-xs text-muted-foreground">{t("advice.disclaimer")}</span>
          </div>
          <p>{advice.summary}</p>
          {advice.steps.length > 0 && (
            <ul className="list-disc space-y-1 ps-5">
              {advice.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          <Button variant="ghost" size="sm" onClick={() => setAdvice(null)}>
            {t("advice.discard")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function CurriculumSelect({ studentId, current, options }: { studentId: string; current: string; options: Opt[] }) {
  const t = useTranslations("pathways");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value={current}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          const res = await setCurriculumAction({ studentId, curriculum: v });
          if (res.ok) toast.success(t("results.curriculumSaved"));
          else toast.error(t("error.generic"));
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="w-52" data-testid="curriculum-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ConfirmButton({ studentId, resultIds, scoreIds }: { studentId: string; resultIds: string[]; scoreIds: string[] }) {
  const t = useTranslations("pathways");
  const router = useRouter();
  const [pending, start] = useTransition();
  const n = resultIds.length + scoreIds.length;
  if (!n) return null;
  return (
    <Button
      size="sm"
      disabled={pending}
      data-testid="confirm-results"
      onClick={() =>
        start(async () => {
          const res = await confirmAction({ studentId, resultIds, scoreIds });
          if (res.ok) toast.success(t("results.confirmed", { n: res.count }));
          else toast.error(t("error.generic"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      {t("results.confirmAll", { n })}
    </Button>
  );
}

export function DeleteRowButton({ id, kind }: { id: string; kind: "result" | "score" }) {
  const t = useTranslations("pathways");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={t("results.delete")}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = kind === "result" ? await deleteResultAction(id) : await deleteScoreAction(id);
          if (!res.ok) toast.error(t("error.generic"));
          router.refresh();
        })
      }
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

/** Add or update a subject result (or the overall total, average or GPA). */
export function ResultDialog({ studentId, subjects, levels, overall }: { studentId: string; subjects: Opt[]; levels: Opt[]; overall: { label: string; levels: Opt[] } | null }) {
  const t = useTranslations("pathways");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(subjects[0]?.value ?? "OVERALL");
  const [level, setLevel] = useState<string>("");
  const [predicted, setPredicted] = useState("");
  const [achieved, setAchieved] = useState("");
  const [pending, start] = useTransition();
  const isOverall = subject === "OVERALL";
  const levelOpts = isOverall ? (overall?.levels ?? []) : levels;
  const effectiveLevel = levelOpts.length ? level || levelOpts[0].value : null;
  const submit = () =>
    start(async () => {
      const res = await saveResultAction({ studentId, subjectCode: subject, level: effectiveLevel, predicted: predicted.trim() || null, achieved: achieved.trim() || null });
      if (res.ok) {
        toast.success(t("results.saved"));
        setOpen(false);
        setPredicted("");
        setAchieved("");
        router.refresh();
      } else toast.error(t(res.error === "empty" ? "results.needValue" : "error.generic"));
    });
  const options = overall ? [{ value: "OVERALL", label: overall.label }, ...subjects] : subjects;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="add-result">
        <Plus className="size-4" />
        {t("results.addResult")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("results.addResult")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("results.subject")}</Label>
              <Select
                value={subject}
                onValueChange={(v) => {
                  setSubject(v);
                  setLevel("");
                }}
              >
                <SelectTrigger className="w-full" data-testid="result-subject">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {levelOpts.length > 0 && (
              <div className="space-y-1">
                <Label>{isOverall ? t("results.stream") : t("results.level")}</Label>
                <Select value={effectiveLevel ?? ""} onValueChange={setLevel}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levelOpts.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="predicted">{t("results.predicted")}</Label>
                <Input id="predicted" value={predicted} onChange={(e) => setPredicted(e.target.value)} maxLength={8} placeholder={t("results.gradeHint")} data-testid="result-predicted" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="achieved">{t("results.achieved")}</Label>
                <Input id="achieved" value={achieved} onChange={(e) => setAchieved(e.target.value)} maxLength={8} data-testid="result-achieved" />
              </div>
            </div>
            <Button className="w-full" disabled={pending || (!predicted.trim() && !achieved.trim())} onClick={submit} data-testid="save-result">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("results.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ScoreDialog({ studentId, kinds }: { studentId: string; kinds: Array<Opt & { min: number; max: number; step: number }> }) {
  const t = useTranslations("pathways");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(kinds[0]?.value ?? "IELTS");
  const [score, setScore] = useState("");
  const [takenAt, setTakenAt] = useState("");
  const [pending, start] = useTransition();
  const k = kinds.find((x) => x.value === kind);
  const n = Number(score);
  const valid = score.trim() !== "" && Number.isFinite(n) && !!k && n >= k.min && n <= k.max;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="add-score">
        <Plus className="size-4" />
        {t("results.addScore")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("results.addScore")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("results.test")}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-full" data-testid="score-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="score">{t("results.score")}</Label>
                <Input id="score" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} data-testid="score-value" />
                {k && <p className="text-[11px] text-muted-foreground">{t("results.range", { min: String(k.min), max: String(k.max) })}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="takenAt">{t("results.takenOn")}</Label>
                <Input id="takenAt" type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={pending || !valid}
              data-testid="save-score"
              onClick={() =>
                start(async () => {
                  const res = await saveScoreAction({ studentId, kind: kind as never, score: n, takenAt: takenAt || null });
                  if (res.ok) {
                    toast.success(t("results.saved"));
                    setOpen(false);
                    setScore("");
                    router.refresh();
                  } else toast.error(t("error.generic"));
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("results.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
