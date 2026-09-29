import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { engineFocus } from "@/server/pathway-engine/page-data";
import { CourseRecordPage } from "@/components/transcripts/views";

export async function generateMetadata() {
  const t = await getTranslations("transcripts.record");
  return { title: t("title") };
}

/** The student's own course record. Staff use /career/pathways/[studentId]/courses. */
export default async function Page({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const ctx = await getCtx();
  const sp = await searchParams;
  if (ctx.isStaff) redirect(sp.student ? `/${ctx.locale}/career/pathways/${encodeURIComponent(sp.student)}/courses` : `/${ctx.locale}/career/pathways`);
  if (ctx.isParent || !ctx.can("pathways.view")) notFound();
  const focus = await engineFocus(ctx, null);
  if (!focus.student) notFound();
  return <CourseRecordPage ctx={ctx} focus={focus} />;
}
