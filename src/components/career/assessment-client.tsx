"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { completeAssessmentAction, saveAnswersAction } from "@/server/career/actions";

type Q = { id: string; text: string; dimension: string };
const PER_PAGE = 5;

export function AssessmentClient({ questions, initial }: { questions: Q[]; initial: Record<string, number> }) {
  const t = useTranslations("career");
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>(initial);
  const firstUnanswered = Math.max(0, questions.findIndex((q) => !initial[q.id]));
  const [page, setPage] = useState(Math.floor(firstUnanswered / PER_PAGE));
  const [pending, start] = useTransition();
  const pages = Math.ceil(questions.length / PER_PAGE);
  const slice = questions.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const done = questions.filter((q) => answers[q.id]).length;
  const pageComplete = slice.every((q) => answers[q.id]);
  const labels = [t("likert.1"), t("likert.2"), t("likert.3"), t("likert.4"), t("likert.5")];

  const next = () =>
    start(async () => {
      await saveAnswersAction(answers);
      if (page < pages - 1) {
        setPage((p) => p + 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        const res = await completeAssessmentAction(answers);
        if (res.ok) router.push("/career?done=1");
      }
    });

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("progress", { done, total: questions.length })}</span>
          <span>{t("pageOf", { page: page + 1, pages })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-brand" animate={{ width: `${(done / questions.length) * 100}%` }} />
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.ol key={page} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
          {slice.map((q, i) => (
            <li key={q.id} className="rounded-xl border bg-card p-5 shadow-xs" data-testid="question" data-dimension={q.dimension} data-index={page * PER_PAGE + i}>
              <p className="mb-4 font-medium">
                <span className="me-2 text-muted-foreground tabular-nums">{page * PER_PAGE + i + 1}.</span>
                {q.text}
              </p>
              <div className="grid grid-cols-5 gap-2">
                {labels.map((label, idx) => {
                  const v = idx + 1;
                  const on = answers[q.id] === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      data-testid={`answer-${v}`}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                      className={cn("flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 text-center text-[11px] leading-tight transition sm:text-xs", on ? "border-brand bg-brand text-brand-foreground shadow-sm" : "hover:border-brand/40 hover:bg-brand-soft/40")}
                    >
                      <span className={cn("size-3 rounded-full border-2", on ? "border-white bg-white" : "border-muted-foreground/40")} style={{ transform: `scale(${0.7 + idx * 0.1})` }} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </motion.ol>
      </AnimatePresence>
      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={page === 0 || pending} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("back")}
        </Button>
        <Button onClick={next} disabled={!pageComplete || pending} data-testid="assessment-next">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {page < pages - 1 ? t("next") : t("seeResults")}
          {page < pages - 1 ? <ChevronRight className="size-4 rtl:rotate-180" /> : <Sparkles className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
