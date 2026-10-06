import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FeesCard } from "@/components/fees/fees-card";

export async function generateMetadata() {
  const t = await getTranslations("fees");
  return { title: t("title") };
}

/** Parents: the school's fee payment portal and fee contact. Hidden until the school sets a link. */
export default async function FeesPage() {
  const ctx = await getCtx();
  if (!ctx.isParent || !ctx.org.feePaymentUrl) notFound();
  const t = await getTranslations("fees");
  return (
    <PageBody className="max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <FeesCard url={ctx.org.feePaymentUrl} contact={ctx.org.feeContact} school={pick(ctx.locale, ctx.org.nameEn, ctx.org.nameAr)} />
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </PageBody>
  );
}
