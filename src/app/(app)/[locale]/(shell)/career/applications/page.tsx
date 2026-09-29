import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Compass, Landmark, Send } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { personName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { AppCardView } from "@/components/applications/app-ui";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { applicationStudentIds, viewerOf } from "@/server/applications/access";
import { loadCards } from "@/server/applications/page-data";

export async function generateMetadata() {
  const t = await getTranslations("applications");
  return { title: t("title") };
}

export default async function ApplicationsPage() {
  const ctx = await getCtx();
  const viewer = viewerOf(ctx);
  if (viewer === "manager") redirect(`/${ctx.locale}/career/applications/manage`);
  if (viewer === "none") notFound();
  const t = await getTranslations("applications");
  const prefs = await formatPrefs(ctx);
  const ids = (await applicationStudentIds(ctx)) ?? [];
  const [cards, students] = await Promise.all([loadCards(ctx, prefs, { studentId: { in: ids } }), ctx.db.student.findMany({ where: { id: { in: ids } }, orderBy: { gradeLevel: "desc" } })]);
  const parent = viewer === "parent";

  return (
    <PageBody>
      <PageHeader title={t("title")} description={parent ? t("subtitleParent") : t("subtitle")} />
      {parent && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="parent-readonly">{t("parentReadOnly")}</p>}
      {students.map((s) => {
        const mine = cards.filter((c) => c.studentId === s.id);
        return (
          <section key={s.id} className="space-y-3" data-testid="student-applications">
            {parent && <h2 className="text-sm font-semibold">{personName(s, ctx.locale)}</h2>}
            {mine.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {mine.map((a) => (
                  <AppCardView key={a.id} a={a} country={countryLabel(a.countryCode, ctx.locale)} />
                ))}
              </div>
            ) : s.gradeLevel < 12 ? (
              <EmptyState
                icon={<Compass className="size-5" />}
                title={t("emptyEarlyTitle")}
                body={t("emptyEarlyBody", { name: personName(s, ctx.locale), grade: s.gradeLevel })}
                action={
                  !parent ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button asChild size="sm" data-testid="open-plan">
                        <Link href="/career/pathways">{t("openPlan")}</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/career/universities">
                          <Landmark className="size-4" />
                          {t("openShortlist")}
                        </Link>
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                icon={<Send className="size-5" />}
                title={parent ? t("emptyParentTitle") : t("emptyTitle")}
                body={parent ? t("emptyParentBody") : t("emptyBody")}
                action={
                  !parent ? (
                    <Button asChild size="sm">
                      <Link href="/career">{t("openShortlist")}</Link>
                    </Button>
                  ) : undefined
                }
              />
            )}
          </section>
        );
      })}
    </PageBody>
  );
}
