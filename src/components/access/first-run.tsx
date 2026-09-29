import { getTranslations } from "next-intl/server";
import { BellRing, CalendarClock, ClipboardCheck, GraduationCap, Inbox, Sparkles, Users } from "lucide-react";
import type { Ctx } from "@/server/context";
import { Link } from "@/i18n/navigation";
import { personName, pick } from "@/lib/i18n-data";
import { showFirstRun } from "@/server/access/first-run";
import { DismissFirstRun } from "./first-run-dismiss";

type Tip = { key: string; href: string; icon: React.ReactNode };

/** Small welcome card for people in their first two weeks: what to do first and how to get notified. */
export async function FirstRunCard({ ctx, audience }: { ctx: Ctx; audience: "parent" | "teacher" }) {
  if (!(await showFirstRun(ctx.membership))) return null;
  const t = await getTranslations("firstRun");
  const kids = audience === "parent" ? (ctx.membership.guardian?.links ?? []).map((l) => l.student) : [];
  const tips: Tip[] =
    audience === "parent"
      ? [
          { key: "requests", href: "/services", icon: <Inbox className="size-4" /> },
          { key: "meetings", href: "/meetings", icon: <CalendarClock className="size-4" /> },
          { key: "grades", href: ctx.can("grades.view_own") ? "/grades" : "/children", icon: <ClipboardCheck className="size-4" /> },
        ]
      : [
          { key: "gradebook", href: "/grades", icon: <ClipboardCheck className="size-4" /> },
          { key: "refer", href: "/services", icon: <Users className="size-4" /> },
          { key: "teacherMeetings", href: "/meetings", icon: <CalendarClock className="size-4" /> },
        ];
  return (
    <section className="rounded-xl border border-brand/20 bg-brand-soft/40 p-5" data-testid="first-run">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-brand" />
          <div>
            <h2 className="text-base font-semibold">{t("title", { school: pick(ctx.locale, ctx.org.shortNameEn || ctx.org.nameEn, ctx.org.shortNameAr || ctx.org.nameAr) })}</h2>
            <p className="text-sm text-muted-foreground">{t(audience === "parent" ? "parentBody" : "teacherBody")}</p>
          </div>
        </div>
        <DismissFirstRun />
      </div>
      {kids.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {kids.map((k) => (
            <Link key={k.id} href={`/children/${k.id}`} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm hover:border-brand/40" data-testid="first-run-child">
              <GraduationCap className="size-4 text-brand" />
              {personName(k, ctx.locale)}
              <span className="text-xs text-muted-foreground">{t("gradeN", { grade: k.gradeLevel })}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {tips.map((tip) => (
          <Link key={tip.key} href={tip.href} className="flex items-start gap-2.5 rounded-lg border bg-card p-3 transition hover:border-brand/40 hover:shadow-xs">
            <span className="mt-0.5 text-brand">{tip.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t(`tips.${tip.key}.title`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`tips.${tip.key}.body`)}</span>
            </span>
          </Link>
        ))}
      </div>
      <Link href="/settings#notifications" className="mt-3 flex items-center gap-2 text-sm font-medium text-brand hover:underline">
        <BellRing className="size-4" />
        {t("notifications")}
      </Link>
    </section>
  );
}
