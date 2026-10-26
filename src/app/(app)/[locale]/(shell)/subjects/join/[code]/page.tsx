import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Clock, School } from "lucide-react";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { registrationYear } from "@/server/registration/service";
import { sessionActive } from "@/server/registration/selection";
import { PageBody } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export async function generateMetadata() {
  const t = await getTranslations("selection.join");
  return { title: t("title") };
}

/** Where the class session QR code and short link lead: the student's own course screen while the session runs. */
export default async function JoinSessionPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale: routeLocale, code } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("selection.join");
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const data = await tenantTx(ctx.orgId, async (tx) => {
    const s = await tx.courseSelectionSession.findFirst({ where: { orgId: ctx.orgId, code: clean } });
    if (!s) return null;
    const cls = await tx.schoolClass.findFirst({ where: { orgId: ctx.orgId, id: s.classId } });
    const target = await registrationYear(tx, ctx.orgId, s.academicYearId);
    const inClass = ctx.membership.student ? !!(await tx.enrollment.findFirst({ where: { orgId: ctx.orgId, classId: s.classId, studentId: ctx.membership.student.id } })) : false;
    return { s, cls, next: !!target?.next, inClass };
  });
  if (!data) notFound();
  const { s, cls } = data;
  const className = cls ? pick(ctx.locale, cls.nameEn, cls.nameAr) : "";
  // Staff who open the link see the live screen instead.
  if (ctx.isStaff) redirect(`/${routeLocale}/subjects/session/${s.id}`);
  if (ctx.isStudent && data.inClass && sessionActive(s, new Date())) redirect(`/${routeLocale}/subjects?year=${data.next ? "next" : "current"}`);
  const ended = !sessionActive(s, new Date());
  return (
    <PageBody>
      <EmptyState
        icon={ended ? <Clock className="size-5" /> : <School className="size-5" />}
        title={ended ? t("endedTitle", { name: className }) : t("otherClassTitle", { name: className })}
        body={ended ? t("endedBody") : t("otherClassBody")}
        action={
          <Button asChild variant="outline">
            <Link href="/subjects">{t("open")}</Link>
          </Button>
        }
      />
    </PageBody>
  );
}
