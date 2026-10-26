import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { AttendanceTabs } from "@/components/attendance/attendance-tabs";
import { AttendanceSettingsForm, CodesEditor } from "@/components/attendance/settings-forms";
import { attViewer } from "@/server/attendance/registers";
import { canConfigure } from "@/server/attendance/admin";
import { loadCodes, loadSettings } from "@/server/attendance/settings";
import { CATEGORIES } from "@/server/attendance/codes";

export async function generateMetadata() {
  const t = await getTranslations("attendance.settings");
  return { title: t("title") };
}

export default async function AttendanceSettingsPage() {
  const ctx = await getCtx();
  if (!canConfigure(attViewer(ctx))) notFound();
  const t = await getTranslations("attendance.settings");
  const tc = await getTranslations("attendance.codes");
  const tg = await getTranslations("gradeLevel");
  const [settings, { codes, custom }, staff] = await Promise.all([
    loadSettings(ctx.db),
    loadCodes(ctx.db),
    ctx.db.membership.findMany({ where: { status: "ACTIVE", student: { is: null }, guardian: { is: null } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } }, orderBy: { user: { nameEn: "asc" } }, take: 1000 }),
  ]);
  return (
    <PageBody className="max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AttendanceTabs ctx={ctx} current="settings" />
      <AttendanceSettingsForm
        initial={{
          mode: settings.mode,
          dailyStart: settings.dailyStart,
          lateCutoffMin: settings.lateCutoffMin,
          closeTime: settings.closeTime,
          followUpTime: settings.followUpTime,
          autoNotify: settings.autoNotify,
          persistentThreshold: settings.persistentThreshold,
          persistentMinDays: settings.persistentMinDays,
          dailyOnlyGrades: settings.dailyOnlyGrades,
          headsOfYear: settings.headsOfYear,
          limitEnabled: settings.limit.enabled,
          limitConsecutive: settings.limit.consecutive,
          limitTotal: settings.limit.total,
          limitWarnPct: settings.limit.warnPct,
        }}
        grades={ALL_GRADE_LEVELS.map((g) => ({ value: g, label: tg("label", gradeLevelValues(g)) }))}
        staff={staff.map((m) => ({ id: m.id, name: pick(ctx.locale, m.user.nameEn, m.user.nameAr) }))}
      />
      <div className="space-y-2 pt-4">
        <h2 className="text-lg font-semibold">{tc("title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{tc("subtitle")}</p>
      </div>
      <CodesEditor initial={codes.map((c) => ({ code: c.code, labelEn: c.labelEn, labelAr: c.labelAr, countsAs: c.countsAs, authorised: c.authorised, late: c.late, category: c.category, private: c.private, quick: c.quick, active: c.active }))} categories={[...CATEGORIES]} custom={custom} />
    </PageBody>
  );
}
