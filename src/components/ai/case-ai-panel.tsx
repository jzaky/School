"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Lock, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { caseBriefAction, reviewAiAction, type CaseBrief } from "@/server/ai/features";

export function CaseAiPanel({ caseId, sensitive, aiEnabled, aiSensitiveEnabled }: { caseId: string; sensitive: boolean; aiEnabled: boolean; aiSensitiveEnabled: boolean }) {
  const t = useTranslations("ai");
  const [brief, setBrief] = useState<{ data: CaseBrief; id: string } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<boolean | null>(null);
  const [pending, start] = useTransition();
  const locked = !aiEnabled || (sensitive && !aiSensitiveEnabled);
  return (
    <section className="rounded-xl border border-violet-200 bg-gradient-to-b from-violet-50/80 to-card p-5 shadow-xs">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-violet-600" />
        <h2 className="text-sm font-semibold">{t("assistant")}</h2>
      </div>
      {locked ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="ai-locked">
          <Lock className="mt-0.5 size-4 shrink-0" />
          {!aiEnabled ? t("disabled") : t("sensitiveBlocked")}
        </p>
      ) : !brief ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("briefIntro")}</p>
          <Button
            size="sm"
            className="w-full bg-violet-600 text-white hover:bg-violet-700"
            disabled={pending}
            data-testid="ai-brief"
            onClick={() =>
              start(async () => {
                const res = await caseBriefAction(caseId);
                if (res.status === "ok") setBrief({ data: res.output, id: res.interactionId });
                else if (res.status === "blocked") setBlocked(res.reason);
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t("prepareBrief")}
          </Button>
          {blocked && <p className="text-xs text-muted-foreground">{blocked === "sensitive" ? t("sensitiveBlocked") : t("disabled")}</p>}
        </div>
      ) : (
        <div className="space-y-4 text-sm" data-testid="ai-brief-result">
          <div className="rounded-md bg-violet-100/70 px-2 py-1 text-[11px] font-medium text-violet-800">{t("draftNotice")}</div>
          <p className="leading-relaxed">{brief.data.summary}</p>
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">{t("keyPoints")}</div>
            <ul className="list-disc space-y-1 ps-4">
              {brief.data.keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">{t("questions")}</div>
            <ol className="list-decimal space-y-1 ps-4">
              {brief.data.questions.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ol>
          </div>
          {brief.data.watchFor.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">{t("watchFor")}</div>
              <ul className="list-disc space-y-1 ps-4 text-muted-foreground">
                {brief.data.watchFor.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}
          {reviewed === null ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => start(async () => { await reviewAiAction(brief.id, true); setReviewed(true); })}>
                <Check className="size-4" />
                {t("useful")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => start(async () => { await reviewAiAction(brief.id, false); setBrief(null); })}>
                <X className="size-4" />
                {t("discard")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-success">{t("reviewedNote")}</p>
          )}
        </div>
      )}
    </section>
  );
}
