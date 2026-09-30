import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, Contact, FileSpreadsheet, GraduationCap, School } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { userName } from "@/lib/i18n-data";
import { moduleEnabled } from "@/lib/modules";
import { STUDENT_COLUMNS, templateCsv as studentsTemplateCsv } from "@/lib/people-csv";
import { STAFF_COLUMNS, staffTemplateCsv } from "@/lib/imports/staff";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS, classesTemplateCsv, enrollmentsTemplateCsv } from "@/lib/imports/classes";
import { isImportKind, type RowIssue } from "@/lib/imports/types";
import type { ColumnSpec } from "@/lib/imports/headers";
import { importAccess } from "@/server/imports/access";
import { registrationTemplate } from "@/server/imports/reuse";
import { schoolVerified } from "@/server/onboarding/verification";
import { REGISTRATION_COLUMNS } from "@/lib/registration-csv";
import { STAFF_ROLE_KEYS } from "@/server/identity/permissions";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { ImportStep, IssueList, type ColumnInfo } from "@/components/imports/import-step";

export async function generateMetadata() {
  const t = await getTranslations("imports");
  return { title: t("title") };
}

const cols = (specs: ColumnSpec[]): ColumnInfo[] => specs.map((c) => ({ key: c.key, en: c.en, ar: c.ar, required: c.required }));

export default async function ImportCenterPage() {
  const ctx = await getCtx();
  const access = importAccess(ctx.perms);
  if (!access.center) notFound();
  const t = await getTranslations("imports");
  const prefs = await formatPrefs(ctx);
  const { db, locale, org } = ctx;
  const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const registrationOn = moduleEnabled(org, "registration");
  const [staff, students, guardians, classes, enrollments, registrations, verified, regTemplate, imports] = await Promise.all([
    db.membership.count({ where: { student: { is: null }, guardian: { is: null }, roles: { some: { role: { key: { in: STAFF_ROLE_KEYS } } } } } }),
    db.student.count({ where: { status: "ACTIVE" } }),
    db.guardian.count(),
    year ? db.schoolClass.count({ where: { academicYearId: year.id } }) : 0,
    year ? db.enrollment.count({ where: { class: { academicYearId: year.id } } }) : 0,
    year && registrationOn ? db.subjectRegistration.groupBy({ by: ["studentId"], where: { academicYearId: year.id } }).then((r) => r.length) : 0,
    schoolVerified(org, ctx.user),
    registrationOn ? registrationTemplate(ctx.orgId) : null,
    db.csvImport.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const byIds = [...new Set(imports.map((i) => i.createdById))];
  const members = byIds.length ? await db.membership.findMany({ where: { id: { in: byIds } }, include: { user: true } }) : [];
  const n = (x: number) => fmtNumber(prefs, x);

  const invite = { allowed: access.invite && verified, reason: !access.invite ? t("invite.noPermission") : !verified ? t("invite.unverified") : null };
  const regDisabled = !access.registrations ? t("steps.registrations.noPermission") : regTemplate && regTemplate.codes === 0 ? t("steps.registrations.noOptions") : null;
  const noYear = year ? null : t("failure.NO_YEAR");

  const steps = [
    { key: "staff", icon: Contact, status: t("status.staff", { count: n(staff) }), done: staff > 1 },
    { key: "students", icon: GraduationCap, status: t("status.students", { students: n(students), guardians: n(guardians) }), done: students > 0 },
    { key: "classes", icon: School, status: t("status.classes", { classes: n(classes), enrollments: n(enrollments) }), done: classes > 0 },
    ...(registrationOn ? [{ key: "registrations", icon: BookOpen, status: t("status.registrations", { count: n(registrations) }), done: registrations > 0 }] : []),
  ];

  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/people">{t("openPeople")}</Link>
          </Button>
        }
      />
      <Panel>
        <h2 className="text-sm font-semibold">{t("order.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("order.body")}</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.key}>
              <a href={`#step-${s.key}`} className="flex h-full items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50" data-testid={`order-${s.key}`}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{n(i + 1)}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(`steps.${s.key}.title`)}</span>
                  <span className="block text-xs text-muted-foreground">{s.status}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </Panel>

      {steps.map((s, i) => (
        <Panel key={s.key} className="scroll-mt-20">
          <section id={`step-${s.key}`} className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                  <s.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{t("stepN", { n: n(i + 1) })}</p>
                  <h2 className="text-base font-semibold">{t(`steps.${s.key}.title`)}</h2>
                  <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{t(`steps.${s.key}.body`)}</p>
                </div>
              </div>
              <Pill tone={s.done ? "success" : "neutral"} dot>
                {s.status}
              </Pill>
            </div>
            {s.key === "staff" && <ImportStep kind="staff" template={staffTemplateCsv()} templateName="staff-template.csv" columns={cols(STAFF_COLUMNS)} invite={invite} hint={t("steps.staff.hint")} />}
            {s.key === "students" && <ImportStep kind="students" template={studentsTemplateCsv()} templateName="students-guardians-template.csv" columns={cols(STUDENT_COLUMNS)} hint={t("steps.students.hint")} />}
            {s.key === "classes" && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">{t("steps.classes.classesFile")}</h3>
                  <ImportStep kind="classes" template={classesTemplateCsv()} templateName="classes-template.csv" columns={cols(CLASS_COLUMNS)} disabledReason={noYear} hint={t("steps.classes.hint")} />
                </div>
                <div className="space-y-2 border-t pt-4">
                  <h3 className="text-sm font-semibold">{t("steps.classes.enrollmentsFile")}</h3>
                  <ImportStep kind="enrollments" template={enrollmentsTemplateCsv()} templateName="enrollments-template.csv" columns={cols(ENROLLMENT_COLUMNS)} disabledReason={noYear} hint={t("steps.classes.enrollmentsHint")} />
                </div>
              </div>
            )}
            {s.key === "registrations" && regTemplate && (
              <div className="space-y-2">
                <ImportStep
                  kind="registrations"
                  template={regTemplate.csv}
                  templateName="subject-choices-template.csv"
                  columns={REGISTRATION_COLUMNS}
                  disabledReason={regDisabled}
                  hint={t("steps.registrations.hint")}
                />
                {access.registrations && (
                  <Link href="/admin/registration" className="inline-block text-sm font-medium text-brand hover:underline">
                    {t("steps.registrations.open")}
                  </Link>
                )}
              </div>
            )}
          </section>
        </Panel>
      ))}

      <section className="space-y-3" data-testid="import-history">
        <h2 className="text-sm font-semibold">{t("history.title")}</h2>
        {imports.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet className="size-5" />} title={t("history.empty")} body={t("history.emptyBody")} />
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {imports.map((i) => {
              const by = members.find((m) => m.id === i.createdById);
              const errors = Array.isArray(i.errors) ? (i.errors as RowIssue[]) : [];
              const kind = isImportKind(i.entity) ? i.entity : null;
              return (
                <li key={i.id} className="space-y-2 px-4 py-3 sm:px-5" data-testid="history-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {kind && <Pill tone="brand">{t(`kinds.${kind}`)}</Pill>}
                        <span className="truncate text-sm font-medium" dir="ltr">
                          {i.fileName}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmtDateTime(prefs, i.createdAt)}
                        {by ? ` · ${userName(by.user, locale)}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{t("history.counts", { succeeded: n(i.succeeded), total: n(i.total), failed: n(i.failed) })}</span>
                      <Pill tone={i.status === "COMPLETED" ? (i.failed ? "warning" : "success") : i.status === "FAILED" ? "danger" : "info"} dot>
                        {t(`history.status.${i.status}`)}
                      </Pill>
                    </div>
                  </div>
                  {errors.length > 0 && <IssueList issues={errors} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageBody>
  );
}
