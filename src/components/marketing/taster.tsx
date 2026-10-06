"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Compass, Loader2, Lock, MailCheck, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { submitTasterLeadAction, tasterTeaserAction, type LeadState } from "@/server/marketing/actions";
import type { Teaser } from "@/server/marketing/taster";
import { LeadContactFields } from "./lead-fields";

export type TasterQuestionView = { id: string; text: string };

const SCALE = [1, 2, 3, 4, 5] as const;

export function CareerTaster({ questions, locale }: { questions: TasterQuestionView[]; locale: "en" | "ar" }) {
  const t = useTranslations("growth.taster");
  const [step, setStep] = useState<"intro" | "questions" | "teaser">("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [teaser, setTeaser] = useState<Teaser | null>(null);
  const [scoreError, setScoreError] = useState<"rate" | "answers" | "failed" | null>(null);
  const [scoring, startScoring] = useTransition();
  const [state, action, submitting] = useActionState<LeadState, FormData>(submitTasterLeadAction, { error: null });
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const NextIcon = locale === "ar" ? ArrowLeft : ArrowRight;

  const q = questions[index];
  const total = questions.length;
  const answered = Object.keys(answers).length;

  function score(all: Record<string, number>) {
    setScoreError(null);
    startScoring(async () => {
      try {
        const res = await tasterTeaserAction(all, locale);
        if (res.ok) {
          setTeaser(res.teaser);
          setStep("teaser");
        } else setScoreError(res.error);
      } catch {
        setScoreError("failed");
      }
    });
  }

  function choose(v: number) {
    const next = { ...answers, [q.id]: v };
    setAnswers(next);
    if (index < total - 1) setIndex(index + 1);
    else score(next);
  }

  function restart() {
    setAnswers({});
    setIndex(0);
    setTeaser(null);
    setStep("questions");
  }

  if (step === "intro") {
    return (
      <div className="rounded-2xl border bg-card p-6 shadow-xs sm:p-8" data-testid="taster-intro">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
          <Compass className="size-5" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">{t("introTitle")}</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>{t("introPoint1", { n: total })}</li>
          <li>{t("introPoint2")}</li>
          <li>{t("introPoint3")}</li>
        </ul>
        <Button size="lg" className="mt-6" onClick={() => setStep("questions")} data-testid="taster-start">
          {t("start")}
          <NextIcon className="size-4" />
        </Button>
      </div>
    );
  }

  if (step === "questions") {
    return (
      <div className="rounded-2xl border bg-card p-5 shadow-xs sm:p-8" data-testid="taster-questions">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span data-testid="taster-progress">{t("progress", { n: index + 1, total })}</span>
          <span>{Math.round((answered / total) * 100)}%</span>
        </div>
        <Progress value={(answered / total) * 100} className="mt-2 h-1.5" />
        <AnimatePresence mode="wait">
          <motion.div key={q.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            <p className="mt-6 min-h-16 text-lg font-medium leading-relaxed sm:text-xl" data-testid="taster-question">
              {q.text}
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-5" role="radiogroup" aria-label={q.text}>
              {SCALE.map((v) => {
                const selected = answers[q.id] === v;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={scoring}
                    onClick={() => choose(v)}
                    data-testid={`taster-answer-${v}`}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3 text-start text-sm transition hover:border-brand/40 hover:bg-brand-soft/40 sm:flex-col sm:justify-center sm:gap-1.5 sm:px-2 sm:text-center",
                      selected && "border-brand bg-brand-soft/60 font-medium",
                    )}
                  >
                    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-xs tabular-nums", selected && "border-brand bg-brand text-white")}>{v}</span>
                    {t(`scale${v}`)}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0 || scoring}>
            <BackIcon className="size-4" />
            {t("back")}
          </Button>
          {scoring && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" />
              {t("scoring")}
            </span>
          )}
          {!scoring && answered === total && (
            <Button size="sm" onClick={() => score(answers)} data-testid="taster-see">
              {t("seeResult")}
            </Button>
          )}
        </div>
        {scoreError && (
          <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {t(`scoreError.${scoreError}`)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="taster-teaser">
      <div className="rounded-2xl border bg-card p-5 shadow-xs sm:p-8">
        <h2 className="text-lg font-semibold">{t("teaserTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("teaserBody")}</p>
        <ol className="mt-5 space-y-3">
          {(teaser ?? []).map((a, i) => (
            <li key={a.key} className="rounded-xl border p-4" data-testid="taster-area">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2.5 font-semibold">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs text-white tabular-nums">{i + 1}</span>
                  {a.name}
                </p>
                <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand tabular-nums">{t("match", { score: a.matchScore })}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.explanation}</p>
            </li>
          ))}
        </ol>
        <Button variant="ghost" size="sm" className="mt-4" onClick={restart}>
          <RotateCcw className="size-4" />
          {t("restart")}
        </Button>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-xs sm:p-8" id="unlock">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold-soft text-[oklch(0.5_0.1_80)]">
            <Lock className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">{t("unlockTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("unlockBody")}</p>
          </div>
        </div>
        {state.ok ? (
          <p className="mt-6 flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success" role="status">
            <MailCheck className="size-4" />
            {t("sentGeneric")}
          </p>
        ) : (
          <form action={action} className="mt-6 space-y-4" data-testid="taster-lead-form">
            <input type="hidden" name="answers" value={JSON.stringify(answers)} />
            <LeadContactFields locale={locale} state={state} schoolRequired={false} consentText={t("consent")} />
            <Button type="submit" size="lg" disabled={submitting} data-testid="taster-submit">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </form>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}
