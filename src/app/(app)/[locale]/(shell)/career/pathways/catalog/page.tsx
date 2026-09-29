import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { CatalogView } from "@/components/transcripts/views";

export async function generateMetadata() {
  const t = await getTranslations("transcripts.catalog");
  return { title: t("title") };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ track?: string; grade?: string; q?: string }> }) {
  return <CatalogView ctx={await getCtx()} sp={await searchParams} />;
}
