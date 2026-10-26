import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { canManageAdmissions } from "@/server/admissions/access";
import { admissionYears, asTx, loadSettings } from "@/server/admissions/settings";
import { schoolAuthority } from "@/server/admissions/registration";
import { SettingsForm } from "@/components/admissions/settings-form";

export async function generateMetadata() {
  const t = await getTranslations("admissions.settings");
  return { title: t("title") };
}

export default async function AdmissionsSettingsPage() {
  const ctx = await getCtx();
  if (!canManageAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.settings");
  const tx = asTx(ctx.db);
  const [s, years] = await Promise.all([loadSettings(tx, ctx.orgId), admissionYears(tx, ctx.orgId)]);
  const authority = schoolAuthority(s.row, ctx.org.regulator);
  return (
    <PageBody className="max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SettingsForm
        slug={ctx.org.slug}
        shortName={ctx.org.shortNameEn ?? ctx.org.nameEn}
        canAddYear={ctx.can("calendar.manage")}
        years={years.map((y) => ({ value: y.id, label: pick(ctx.locale, y.nameEn, y.nameAr), current: y.isCurrent }))}
        initial={{
          publicOpen: s.publicOpen,
          openYearIds: s.openYearIds,
          cutoffMonth: s.cutoff.month,
          cutoffDay: s.cutoff.day,
          admissionNoPattern: s.pattern,
          offerDays: s.offerDays,
          introEn: s.intro.en ?? "",
          introAr: s.intro.ar ?? "",
          authority: authority.key,
          authorityLabelEn: authority.labelEn ?? "",
          authorityLabelAr: authority.labelAr ?? "",
          stages: s.stages.map((x) => ({ key: x.key, labelEn: x.labelEn, labelAr: x.labelAr, hidden: x.hidden, custom: x.custom, phase: x.phase })),
          documentTypes: s.docTypes,
        }}
      />
    </PageBody>
  );
}
