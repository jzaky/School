import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { engineFocus } from "@/server/pathway-engine/page-data";
import { CourseRecordPage } from "@/components/transcripts/views";

export async function generateMetadata() {
  const t = await getTranslations("transcripts.record");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const ctx = await getCtx();
  if (ctx.isParent || !ctx.can("pathways.view")) notFound();
  const focus = await engineFocus(ctx, studentId);
  if (!focus.student || focus.student.id !== studentId) notFound();
  return <CourseRecordPage ctx={ctx} focus={focus} />;
}
