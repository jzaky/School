"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminQuestionAction } from "@/server/ai/features";

type Answer = { answer: string; bullets: string[]; provider: string };

/** Ask questions about school operations. Answers use aggregate, non-sensitive figures only. */
export function AskInsights({ suggestions }: { suggestions: string[] }) {
  const t = useTranslations("analytics");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const ask = (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setError(false);
    start(async () => {
      const res = await adminQuestionAction(question);
      if (res.status === "ok") setAnswer({ ...res.output, provider: res.provider });
      else setError(true);
    });
  };
  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("askPlaceholder")} data-testid="ask-input" maxLength={300} />
        <Button type="submit" disabled={pending || !q.trim()} aria-label={t("ask")} data-testid="ask-submit">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 rtl:-scale-x-100" />}
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => ask(s)} disabled={pending} className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-muted">
            {s}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{t("askError")}</p>}
      {answer && (
        <div className="rounded-xl border bg-brand-soft/30 p-4" data-testid="ask-answer" aria-live="polite">
          <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
            <Sparkles className="size-3.5" />
            {answer.provider === "anthropic" ? t("aiAnswer") : t("builtInAnswer")}
          </p>
          <p className="mt-2 text-sm leading-relaxed">{answer.answer}</p>
          {answer.bullets.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
              {answer.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">{t("askFootnote")}</p>
        </div>
      )}
    </div>
  );
}
