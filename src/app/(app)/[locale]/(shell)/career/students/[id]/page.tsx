import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { personName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { CareerOverview } from "@/components/career/career-overview";

export default async function AdvisorStudentCareer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.can("career.advise")) notFound();
  const t = await getTranslations("career");
  const prefs = await formatPrefs(ctx);
  const s = await ctx.db.student.findUnique({ where: { id } });
  if (!s) notFound();
  return (
    <PageBody>
      <Link href="/career" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("advisorTitle")}
      </Link>
      <PageHeader
        title={personName(s, ctx.locale)}
        description={t("gradeN", { grade: `${s.gradeLevel}${s.section ?? ""}` })}
        actions={
          <Button asChild variant="outline">
            <Link href={`/students/${s.id}`}>{t("fullProfile")}</Link>
          </Button>
        }
      />
      <CareerOverview ctx={ctx} prefs={prefs} studentId={s.id} mode="advisor" />
    </PageBody>
  );
}
