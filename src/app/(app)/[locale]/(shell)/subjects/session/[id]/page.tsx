import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { getCtx } from "@/server/context";
import { personName, pick } from "@/lib/i18n-data";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { getSelectionSettings, progressFor, selectionActorFromCtx, sessionActive, sessionClasses } from "@/server/registration/selection";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { SessionLive } from "@/components/registration/session-live";

export async function generateMetadata() {
  const t = await getTranslations("selection.session");
  return { title: t("liveTitle") };
}

export default async function ClassSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.isStaff) notFound();
  const t = await getTranslations("selection.session");
  const { orgId, locale } = ctx;
  const data = await tenantTx(orgId, async (tx) => {
    const s = await tx.courseSelectionSession.findFirst({ where: { orgId, id } });
    if (!s) return null;
    const classes = await sessionClasses(tx, orgId, selectionActorFromCtx(ctx));
    const cls = classes.find((c) => c.id === s.classId);
    if (!cls) return null;
    const year = await tx.academicYear.findFirst({ where: { orgId, id: s.academicYearId } });
    const roster = await tx.enrollment.findMany({ where: { orgId, classId: cls.id }, include: { student: true } });
    const students = roster.map((r) => r.student).filter((st) => st.status === "ACTIVE");
    const progress = await progressFor(tx, orgId, s.academicYearId, students);
    const settings = await getSelectionSettings(tx, orgId);
    return { s, cls, year, students, progress, settings };
  });
  if (!data) notFound();
  const { s, cls } = data;
  const now = new Date();
  const initial = data.students
    .filter((st) => data.progress.has(st.id))
    .map((st) => {
      const p = data.progress.get(st.id)!;
      return { id: st.id, name: personName(st, locale), status: p.status, chosen: p.chosen, blocks: p.blocks };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const className = pick(locale, cls.nameEn, cls.nameAr);

  return (
    <PageBody>
      <div>
        <Link href="/subjects/session" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("backSessions")}
        </Link>
      </div>
      <PageHeader title={t("liveHeading", { name: className })} description={data.year ? t("liveSubtitle", { year: `⁦${pick(locale, data.year.nameEn, data.year.nameAr)}⁩` }) : undefined} />
      <SessionLive
        id={s.id}
        code={s.code}
        className={className}
        initial={initial}
        endsAt={(s.endedAt ?? s.endsAt).toISOString()}
        active={sessionActive(s, now)}
        signOffRequired={data.settings.signOffRequired}
        serverNow={now.toISOString()}
      />
    </PageBody>
  );
}
