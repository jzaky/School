"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createAssessmentAction, updateAssessmentAction } from "@/server/grades/actions";

export type AssessmentKindKey = "HOMEWORK" | "QUIZ" | "TEST" | "EXAM" | "PROJECT" | "COURSEWORK" | "PARTICIPATION";
const KINDS: AssessmentKindKey[] = ["HOMEWORK", "QUIZ", "TEST", "EXAM", "PROJECT", "COURSEWORK", "PARTICIPATION"];

export type AssessmentRow = {
  id: string;
  titleEn: string;
  titleAr: string;
  kind: AssessmentKindKey;
  maxScore: number;
  weight: number;
  dueAt: string | null; // yyyy-mm-dd
  dueLabel: string | null;
  termId: string | null;
  publishedAt: string | null;
};

export type TermOption = { id: string; label: string; startsOn: string; endsOn: string };

const DEFAULT_WEIGHT: Record<AssessmentKindKey, number> = { HOMEWORK: 1, QUIZ: 1, TEST: 2, EXAM: 3, PROJECT: 2, COURSEWORK: 2, PARTICIPATION: 0.5 };

function termForDate(terms: TermOption[], date: string) {
  if (!date) return null;
  return terms.find((t) => t.startsOn.slice(0, 10) <= date && date <= t.endsOn.slice(0, 10))?.id ?? null;
}

export function NewAssessmentButton({ classId, terms, defaultTermId }: { classId: string; terms: TermOption[]; defaultTermId: string | null }) {
  const t = useTranslations("grades");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-assessment">
        <Plus className="size-4" />
        {t("newAssessment")}
      </Button>
      {open && <AssessmentDialog open onOpenChange={setOpen} classId={classId} terms={terms} defaultTermId={defaultTermId} />}
    </>
  );
}

export function AssessmentDialog({
  open,
  onOpenChange,
  classId,
  terms,
  defaultTermId,
  assessment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  terms: TermOption[];
  defaultTermId: string | null;
  assessment?: AssessmentRow;
}) {
  const t = useTranslations("grades");
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [titleEn, setTitleEn] = useState(assessment?.titleEn ?? "");
  const [titleAr, setTitleAr] = useState(assessment?.titleAr ?? "");
  const [kind, setKind] = useState<AssessmentKindKey>(assessment?.kind ?? "QUIZ");
  const [maxScore, setMaxScore] = useState(String(assessment?.maxScore ?? 20));
  const [weight, setWeight] = useState(String(assessment?.weight ?? DEFAULT_WEIGHT.QUIZ));
  const [dueAt, setDueAt] = useState(assessment?.dueAt ?? today);
  const [termId, setTermId] = useState(assessment?.termId ?? termForDate(terms, assessment?.dueAt ?? today) ?? defaultTermId ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    start(async () => {
      setError(null);
      const input = { titleEn, titleAr, kind, maxScore: Number(maxScore), weight: Number(weight), dueAt: dueAt || null, termId: termId || null };
      const res = assessment ? await updateAssessmentAction(assessment.id, input) : await createAssessmentAction(classId, input);
      if (!res.ok) {
        const code = t.has(`error.${res.error}`) ? res.error : "generic";
        setError(t(`error.${code}`, { max: maxScore }));
        return;
      }
      toast.success(assessment ? t("assessmentUpdated") : t("assessmentCreated"));
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{assessment ? t("editAssessment") : t("newAssessment")}</DialogTitle>
          <DialogDescription>{t("assessmentBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-title-en">{t("titleEn")}</Label>
              <Input id="a-title-en" dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} maxLength={120} data-testid="assessment-title-en" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-title-ar">{t("titleAr")}</Label>
              <Input id="a-title-ar" dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} maxLength={120} data-testid="assessment-title-ar" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t("kindLabel")}</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  const k = v as AssessmentKindKey;
                  if (!assessment && Number(weight) === DEFAULT_WEIGHT[kind]) setWeight(String(DEFAULT_WEIGHT[k]));
                  setKind(k);
                }}
              >
                <SelectTrigger className="w-full" data-testid="assessment-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-max">{t("maxScoreLabel")}</Label>
              <Input id="a-max" type="number" min={1} max={1000} step="any" dir="ltr" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} data-testid="assessment-max" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-weight">{t("weightLabel")}</Label>
              <Input id="a-weight" type="number" min={0.1} max={100} step="any" dir="ltr" value={weight} onChange={(e) => setWeight(e.target.value)} data-testid="assessment-weight" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-due">{t("dueLabel")}</Label>
              <Input
                id="a-due"
                type="date"
                dir="ltr"
                value={dueAt}
                onChange={(e) => {
                  setDueAt(e.target.value);
                  const tid = termForDate(terms, e.target.value);
                  if (tid) setTermId(tid);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("termLabel")}</Label>
              {terms.length ? (
                <Select value={termId} onValueChange={setTermId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("chooseTerm")} />
                  </SelectTrigger>
                  <SelectContent>
                    {terms.map((tt) => (
                      <SelectItem key={tt.id} value={tt.id}>
                        {tt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">{t("noTerms")}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("weightHint")}</p>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !titleEn.trim()} data-testid="assessment-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {assessment ? t("saveChanges") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
