import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ServicesHub, type HubService } from "@/components/services/services-hub";

export async function generateMetadata() {
  const t = await getTranslations("services");
  return { title: t("title") };
}

export default async function ServicesPage() {
  const ctx = await getCtx();
  const t = await getTranslations("services");
  const { db, orgId, locale } = ctx;
  const [categories, services] = await Promise.all([
    db.serviceCategory.findMany({ where: { orgId }, orderBy: { sortOrder: "asc" } }),
    db.serviceDefinition.findMany({ where: { orgId, isActive: true, audience: { hasSome: ctx.roles } }, orderBy: { sortOrder: "asc" } }),
  ]);
  const list: HubService[] = services.map((s) => ({
    key: s.key,
    name: pick(locale, s.nameEn, s.nameAr),
    description: pick(locale, s.descEn, s.descAr),
    icon: s.icon,
    category: s.categoryId,
    featured: s.isFeatured,
    sensitivity: s.sensitivity,
    meeting: Boolean(s.appointmentTypeId),
    slaHours: s.slaHours,
    keywords: `${s.nameEn} ${s.nameAr} ${s.descEn}`,
  }));
  const cats = categories.filter((c) => services.some((s) => s.categoryId === c.id)).map((c) => ({ id: c.id, name: pick(locale, c.nameEn, c.nameAr) }));
  return (
    <PageBody>
      <PageHeader title={t("title")} description={ctx.isStudent ? t("subtitleStudent") : ctx.isParent ? t("subtitleParent") : t("subtitleStaff")} />
      <ServicesHub services={list} categories={cats} />
    </PageBody>
  );
}
