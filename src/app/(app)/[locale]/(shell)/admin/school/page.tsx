import { getTranslations } from "next-intl/server";
import { Building2, CalendarRange, Layers, MapPin } from "lucide-react";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { CampusDialog, DepartmentDialog, SchoolProfileForm, SetCurrentYear } from "@/components/admin/school-forms";

export async function generateMetadata() {
  const t = await getTranslations("adminSchool");
  return { title: t("title") };
}

export default async function SchoolSetupPage() {
  const ctx = await requirePermission("school.manage");
  const t = await getTranslations("adminSchool");
  const prefs = await formatPrefs(ctx);
  const { db, org, locale } = ctx;
  const [campuses, years, departments, staff, subjects] = await Promise.all([
    db.campus.findMany({ orderBy: [{ isMain: "desc" }, { nameEn: "asc" }], include: { _count: { select: { students: true } } } }),
    db.academicYear.findMany({ orderBy: { startsOn: "desc" }, include: { terms: { orderBy: { startsOn: "asc" } } } }),
    db.department.findMany({ orderBy: { nameEn: "asc" }, include: { _count: { select: { staff: true, subjects: true } } } }),
    db.staffProfile.findMany({ include: { membership: { include: { user: true } } } }),
    db.subject.count(),
  ]);
  const staffOptions = staff
    .filter((s) => s.membership.status === "ACTIVE")
    .map((s) => ({ value: s.membershipId, label: pick(locale, s.membership.user.nameEn, s.membership.user.nameAr), hint: pick(locale, s.membership.titleEn, s.membership.titleAr), keywords: `${s.membership.user.nameEn} ${s.membership.user.nameAr ?? ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const staffName = (id: string | null) => staffOptions.find((s) => s.value === id)?.label;

  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Panel>
        <PanelHeader title={t("profile")} description={t("profileHint")} icon={<Building2 className="size-4" />} />
        <SchoolProfileForm
          initial={{
            nameEn: org.nameEn,
            nameAr: org.nameAr,
            shortNameEn: org.shortNameEn ?? "",
            shortNameAr: org.shortNameAr ?? "",
            defaultLocale: org.defaultLocale,
            weekDays: org.weekDays,
            hijriEnabled: org.hijriEnabled,
            numerals: org.numerals,
            regulator: org.regulator,
            emirate: org.emirate,
          }}
        />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader title={t("departments")} description={t("departmentsHint", { subjects: subjects })} icon={<Layers className="size-4" />} action={<DepartmentDialog staff={staffOptions} />} />
          </div>
          <ul className="divide-y">
            {departments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3" data-testid="department-row">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{pick(locale, d.nameEn, d.nameAr)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {staffName(d.headMembershipId) ? t("headedBy", { name: staffName(d.headMembershipId)! }) : t("noHead")} · {t("staffCount", { n: d._count.staff })}
                  </p>
                </div>
                <DepartmentDialog department={d} staff={staffOptions} />
              </li>
            ))}
          </ul>
        </Panel>
        <div className="space-y-6">
          <Panel padded={false}>
            <div className="p-5 pb-0">
              <PanelHeader title={t("years")} description={t("yearsHint")} icon={<CalendarRange className="size-4" />} />
            </div>
            <ul className="divide-y">
              {years.map((y) => (
                <li key={y.id} className="space-y-2 px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {pick(locale, y.nameEn, y.nameAr)}
                      {y.isCurrent && <Pill tone="success">{t("current")}</Pill>}
                    </p>
                    {!y.isCurrent && <SetCurrentYear id={y.id} />}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {y.terms.map((term) => (
                      <span key={term.id} className="rounded-md bg-muted px-2 py-1 text-xs">
                        {pick(locale, term.nameEn, term.nameAr)} · {fmtDate(prefs, term.startsOn, "short")} - {fmtDate(prefs, term.endsOn, "short")}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel padded={false}>
            <div className="p-5 pb-0">
              <PanelHeader title={t("campuses")} icon={<MapPin className="size-4" />} action={<CampusDialog />} />
            </div>
            <ul className="divide-y">
              {campuses.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {pick(locale, c.nameEn, c.nameAr)}
                      {c.isMain && <Pill tone="brand">{t("main")}</Pill>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {pick(locale, c.addressEn, c.addressAr)} · {t("studentCount", { n: c._count.students })}
                    </p>
                  </div>
                  <CampusDialog campus={c} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
