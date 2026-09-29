import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { DashboardView } from "@/components/transcripts/views";

export async function generateMetadata() {
  const t = await getTranslations("transcripts.dashboard");
  return { title: t("title") };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ grade?: string; curriculum?: string; counselor?: string }> }) {
  return <DashboardView ctx={await getCtx()} sp={await searchParams} />;
}
