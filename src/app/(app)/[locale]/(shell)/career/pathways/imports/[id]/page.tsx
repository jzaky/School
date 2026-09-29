import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { ImportReviewView } from "@/components/transcripts/views";

export async function generateMetadata() {
  const t = await getTranslations("transcripts.review");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportReviewView ctx={await getCtx()} id={id} />;
}
