import { getTranslations } from "next-intl/server";
import { CreditCard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "Pay fees" card for parents. Links out to the school's own payment portal. Render only when a link is set. */
export async function FeesCard({ url, contact, school }: { url: string; contact: string | null; school: string }) {
  const t = await getTranslations("fees");
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs sm:flex-row sm:items-center" data-testid="fees-card">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <CreditCard className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{t("cardTitle")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("cardBody", { school })}</p>
        {contact && <p className="mt-1 break-words text-xs text-muted-foreground">{t("contact", { contact })}</p>}
      </div>
      <Button asChild className="w-full sm:w-auto">
        <a href={url} target="_blank" rel="noopener noreferrer" data-testid="pay-fees">
          {t("pay")}
          <ExternalLink className="size-4" />
          <span className="sr-only">{t("newTab")}</span>
        </a>
      </Button>
    </section>
  );
}
