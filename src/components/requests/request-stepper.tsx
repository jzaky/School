import { Check, PenLine, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type StepperStage = {
  id: string;
  label: string;
  state: "done" | "current" | "upcoming" | "rejected" | "skipped";
  when?: string | null;
  who?: string | null;
  comment?: string | null;
  signed?: string | null;
};

/** Vertical progress timeline for a request: done, current, upcoming, rejected. */
export function RequestStepper({ stages }: { stages: StepperStage[] }) {
  const t = useTranslations("requests");
  return (
    <ol className="relative" data-testid="request-stepper">
      {stages.map((s, i) => {
        const last = i === stages.length - 1;
        const nextDone = stages[i + 1]?.state === "done" || stages[i + 1]?.state === "current";
        return (
          <li key={s.id} className="relative flex gap-4 pb-7 last:pb-0" data-state={s.state}>
            {!last && (
              <span
                aria-hidden
                className={cn("absolute start-[15px] top-8 bottom-0 w-0.5 rounded-full", s.state === "done" && nextDone ? "bg-success" : s.state === "done" ? "bg-gradient-to-b from-success to-border" : "bg-border", s.state === "skipped" && "bg-transparent border-s-2 border-dashed border-border")}
              />
            )}
            <span
              className={cn(
                "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
                s.state === "done" && "border-success bg-success text-white",
                s.state === "current" && "border-warning bg-warning-soft text-[oklch(0.55_0.14_65)]",
                s.state === "upcoming" && "border-border bg-card text-muted-foreground",
                s.state === "rejected" && "border-danger bg-danger text-white",
                s.state === "skipped" && "border-dashed border-border bg-card text-muted-foreground/60",
              )}
            >
              {s.state === "done" ? <Check className="size-4" /> : s.state === "rejected" ? <X className="size-4" /> : s.state === "current" ? <span className="size-2.5 animate-pulse rounded-full bg-warning" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={cn("text-sm font-medium", (s.state === "upcoming" || s.state === "skipped") && "text-muted-foreground")}>{s.label}</p>
                {s.when && <time className="text-xs text-muted-foreground">{s.when}</time>}
              </div>
              {s.state === "current" && <p className="mt-0.5 text-xs font-medium text-[oklch(0.55_0.14_65)]">{s.who ? t("waitingFor", { name: s.who }) : t("inProgress")}</p>}
              {s.state !== "current" && s.who && <p className="mt-0.5 text-xs text-muted-foreground">{s.who}</p>}
              {s.comment && <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground/80">“{s.comment}”</p>}
              {s.signed && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-success/25 bg-success-soft px-2 py-1 text-xs text-success">
                  <PenLine className="size-3.5" />
                  {t("signedBy", { name: s.signed })}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
