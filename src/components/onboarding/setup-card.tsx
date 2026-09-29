import { getTranslations } from "next-intl/server";
import { ArrowRight, Rocket } from "lucide-react";
import type { Ctx } from "@/server/context";
import { setupProgress } from "@/lib/onboarding";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/** Compact "Finish setting up" card on an administrator's home page until setup is complete. */
export async function SetupCard({ ctx }: { ctx: Ctx }) {
  const t = await getTranslations("onboarding.card");
  const ts = await getTranslations("onboarding.setup");
  const p = setupProgress(ctx.org.onboardingSteps);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-4 rounded-xl border border-brand/20 bg-brand-soft/50 p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="setup-card">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-foreground">
            <Rocket className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t("title")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{p.next === "done" ? t("almost") : t("next", { step: ts(`steps.${p.next}.nav`) })}</p>
            <div className="mt-2 flex items-center gap-2">
              <Progress value={p.percent} className="h-1.5 w-40 max-w-full" aria-label={t("progress", { done: p.done, total: p.total })} />
              <span className="text-xs tabular-nums text-muted-foreground">{t("progress", { done: p.done, total: p.total })}</span>
            </div>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href={`/setup?step=${p.next}`} data-testid="setup-card-continue">
            {p.done === 0 ? t("start") : t("continue")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
        </Button>
      </section>
    </div>
  );
}
