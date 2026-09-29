import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { ImportsView } from "@/components/transcripts/views";

export async function generateMetadata() {
  const t = await getTranslations("transcripts.imports");
  return { title: t("title") };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const sp = await searchParams;
  return <ImportsView ctx={await getCtx()} studentParam={sp.student ?? null} />;
}
