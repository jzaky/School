import { getTranslations } from "next-intl/server";
import { ArrowRight, Wallet } from "lucide-react";
import type { Ctx } from "@/server/context";
import { Link } from "@/i18n/navigation";
import { pick } from "@/lib/i18n-data";
import { fmtDate, type FormatPrefs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FeesCard } from "./fees-card";
import { Money } from "./shared";
import { parentStatement } from "@/server/fees/parent";
import { balanceOf } from "@/server/fees/ledger";

/** Parent home: the family balance and next due date when the school bills in Horizon, else the portal link card. */
export async function ParentFeesHomeCard({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const st = ctx.isParent && ctx.can("family.portal") ? await parentStatement(ctx) : null;
  if (!st || !st.invoices.length) {
    return ctx.org.feePaymentUrl ? <FeesCard url={ctx.org.feePaymentUrl} contact={ctx.org.feeContact} school={pick(ctx.locale, ctx.org.nameEn, ctx.org.nameAr)} /> : null;
  }
  const t = await getTranslations("finance.parent");
  const overdue = st.nextDue && st.nextDue.dueDate.getTime() < Date.now() - 86_400_000;
  return (
    <Link href="/fees" className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs transition hover:border-brand/25 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between" data-testid="home-fees">
      <div className="flex items-center gap-4">
        <div className={cn("grid size-11 place-items-center rounded-lg", overdue ? "bg-danger-soft text-danger" : "bg-gold-soft text-[oklch(0.55_0.1_80)]")}>
          <Wallet className="size-5" />
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground">{t("homeTitle")}</div>
          <div className="text-xl font-semibold">
            <Money fils={Math.max(0, st.balance)} locale={ctx.locale} />
          </div>
          <div className={cn("text-xs", overdue ? "text-danger" : "text-muted-foreground")}>
            {st.nextDue ? (overdue ? t("wasDue", { date: fmtDate(prefs, st.nextDue.dueDate) }) : t("nextDueLine", { date: fmtDate(prefs, st.nextDue.dueDate) })) : t("allPaid")}
            {st.nextDue ? (
              <>
                {" · "}
                <Money fils={balanceOf(st.nextDue)} locale={ctx.locale} />
              </>
            ) : null}
          </div>
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
        {t("viewStatement")}
        <ArrowRight className="size-4 rtl:rotate-180" />
      </span>
    </Link>
  );
}
