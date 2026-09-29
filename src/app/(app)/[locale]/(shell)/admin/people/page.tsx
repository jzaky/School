import type { MembershipStatus, PersonStatus, Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Contact, FileSpreadsheet, GraduationCap, Mail, Phone, UserX, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { STAFF_ROLE_KEYS } from "@/server/identity/permissions";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill, type Tone } from "@/components/app/badges";
import { PeopleToolbar } from "@/components/admin/people/people-toolbar";
import { AddStaffDialog, EditStaffDialog, MemberStatusButton } from "@/components/admin/people/staff-forms";
import { AddStudentDialog } from "@/components/admin/people/student-forms";
import { GuardianLinkDialog } from "@/components/admin/people/guardian-forms";
import { CsvImporter, ImportErrors } from "@/components/admin/people/csv-import";

export async function generateMetadata() {
  const t = await getTranslations("adminPeople");
  return { title: t("title") };
}

type Tab = "staff" | "students" | "families" | "imports";
const TABS: Tab[] = ["staff", "students", "families", "imports"];
const MEMBER_STATUSES: MembershipStatus[] = ["ACTIVE", "INVITED", "SUSPENDED"];
const STUDENT_STATUSES: PersonStatus[] = ["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"];
const MEMBER_TONE: Record<MembershipStatus, Tone> = { ACTIVE: "success", INVITED: "info", SUSPENDED: "danger", PENDING_APPROVAL: "warning" };
const STUDENT_TONE: Record<PersonStatus, Tone> = { ACTIVE: "success", INACTIVE: "neutral", GRADUATED: "brand", WITHDRAWN: "warning" };
const LIMIT = 200;

export default async function AdminPeoplePage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; role?: string; dept?: string; grade?: string; status?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("people.manage")) notFound();
  const t = await getTranslations("adminPeople");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "staff";
  const q = sp.q?.trim() || "";
  const grade = sp.grade && /^\d{1,2}$/.test(sp.grade) ? Number(sp.grade) : null;

  const staffBase: Prisma.MembershipWhereInput = { student: { is: null }, guardian: { is: null }, roles: { some: { role: { key: { in: STAFF_ROLE_KEYS } } } } };
  const [roles, departments, gradeRows, counts] = await Promise.all([
    db.role.findMany({ orderBy: { nameEn: "asc" } }),
    db.department.findMany({ orderBy: { nameEn: "asc" } }),
    db.student.groupBy({ by: ["gradeLevel"], orderBy: { gradeLevel: "asc" } }),
    Promise.all([
      db.membership.count({ where: staffBase }),
      db.student.count(),
      db.guardian.count(),
      db.csvImport.count(),
      db.membership.count({ where: { ...staffBase, status: "SUSPENDED" } }),
      db.student.count({ where: { status: "ACTIVE" } }),
    ]),
  ]);
  const [staffCount, studentCount, guardianCount, importCount, suspendedCount, activeStudents] = counts;
  const staffRoles = roles.filter((r) => STAFF_ROLE_KEYS.includes(r.key));
  const roleOptions = staffRoles.map((r) => ({ key: r.key, label: pick(locale, r.nameEn, r.nameAr), description: pick(locale, r.descEn, r.descAr) }));
  const deptOptions = departments.map((d) => ({ id: d.id, label: pick(locale, d.nameEn, d.nameAr) }));
  const grades = gradeRows.map((g) => g.gradeLevel);
  const canAdminRole = ctx.can("school.manage");

  const statusFilter = tab === "staff" ? (MEMBER_STATUSES.includes(sp.status as MembershipStatus) ? (sp.status as MembershipStatus) : null) : STUDENT_STATUSES.includes(sp.status as PersonStatus) ? (sp.status as PersonStatus) : null;

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          tab === "staff" ? (
            <AddStaffDialog roles={roleOptions} departments={deptOptions} canAssignAdmin={canAdminRole} />
          ) : tab === "students" || tab === "families" ? (
            <AddStudentDialog guardians={await guardianOptions()} />
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("statStaff")} value={fmtNumber(prefs, staffCount)} icon={<Contact className="size-4" />} />
        <StatCard label={t("statStudents")} value={fmtNumber(prefs, activeStudents)} icon={<GraduationCap className="size-4" />} tone="info" />
        <StatCard label={t("statFamilies")} value={fmtNumber(prefs, guardianCount)} icon={<Users className="size-4" />} tone="gold" />
        <StatCard label={t("statSuspended")} value={fmtNumber(prefs, suspendedCount)} icon={<UserX className="size-4" />} tone={suspendedCount ? "danger" : "success"} />
      </div>
      <PeopleToolbar
        tab={tab}
        tabs={[
          { value: "staff", label: t("tabStaff"), count: staffCount },
          { value: "students", label: t("tabStudents"), count: studentCount },
          { value: "families", label: t("tabFamilies"), count: guardianCount },
          { value: "imports", label: t("tabImports"), count: importCount },
        ]}
        roles={tab === "staff" ? staffRoles.map((r) => ({ value: r.key, label: pick(locale, r.nameEn, r.nameAr) })) : undefined}
        departments={tab === "staff" ? deptOptions.map((d) => ({ value: d.id, label: d.label })) : undefined}
        grades={tab === "students" || tab === "families" ? grades.map((g) => ({ value: String(g), label: t("gradeN", { grade: g }) })) : undefined}
        statuses={
          tab === "staff"
            ? MEMBER_STATUSES.map((s) => ({ value: s, label: t(`memberStatus.${s}`) }))
            : tab === "students"
              ? STUDENT_STATUSES.map((s) => ({ value: s, label: t(`studentStatus.${s}`) }))
              : undefined
        }
        searchPlaceholder={tab === "imports" ? undefined : t(`search.${tab}`)}
      />
      {tab === "staff" && (await staffTab())}
      {tab === "students" && (await studentsTab())}
      {tab === "families" && (await familiesTab())}
      {tab === "imports" && (await importsTab())}
    </PageBody>
  );

  async function guardianOptions() {
    const gs = await db.guardian.findMany({ orderBy: [{ lastNameEn: "asc" }, { firstNameEn: "asc" }], take: 1000 });
    return gs.map((g) => ({ value: g.id, label: personName(g, locale), hint: g.email ?? undefined, keywords: `${g.firstNameEn} ${g.lastNameEn} ${g.firstNameAr} ${g.lastNameAr} ${g.email ?? ""}` }));
  }

  async function staffTab() {
    const where: Prisma.MembershipWhereInput = {
      AND: [
        staffBase,
        statusFilter ? { status: statusFilter as MembershipStatus } : {},
        sp.role ? { roles: { some: { role: { key: sp.role } } } } : {},
        sp.dept ? { staffProfile: { is: { departmentId: sp.dept } } } : {},
        q
          ? {
              OR: [
                { user: { nameEn: { contains: q, mode: "insensitive" } } },
                { user: { nameAr: { contains: q } } },
                { user: { email: { contains: q, mode: "insensitive" } } },
                { titleEn: { contains: q, mode: "insensitive" } },
                { titleAr: { contains: q } },
              ],
            }
          : {},
      ],
    };
    const [members, total, admins] = await Promise.all([
      db.membership.findMany({ where, include: { user: true, roles: { include: { role: true } }, staffProfile: { include: { department: true } } }, orderBy: { user: { nameEn: "asc" } }, take: LIMIT }),
      db.membership.count({ where }),
      db.membership.findMany({ where: { status: "ACTIVE", roles: { some: { role: { key: "school_admin" } } } }, select: { id: true } }),
    ]);
    if (members.length === 0) return <EmptyState icon={<Contact className="size-5" />} title={t("emptyStaff")} body={t("emptyFiltered")} />;
    const lastAdminId = admins.length === 1 ? admins[0].id : null;
    return (
      <Table endLast cols="lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_110px_190px]" header={[t("colName"), t("colTitleDept"), t("colRoles"), t("colStatus"), t("colActions")]} footer={total > members.length ? t("showing", { shown: members.length, total }) : undefined}>
        {members.map((m) => {
          const name = userName(m.user, locale);
          const other = locale === "ar" ? m.user.nameEn : m.user.nameAr;
          const keys = m.roles.map((r) => r.role.key);
          const isAdmin = keys.includes("school_admin");
          const title = pick(locale, m.staffProfile?.jobTitleEn ?? m.titleEn, m.staffProfile?.jobTitleAr ?? m.titleAr);
          return (
            <Row key={m.id} cols="lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_110px_190px]" testId="staff-row">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {name}
                  {m.id === ctx.membershipId && <Pill>{t("you")}</Pill>}
                </div>
                {other && other !== name && <div className="truncate text-xs text-muted-foreground">{other}</div>}
                <div className="truncate text-xs text-muted-foreground">
                  <span dir="ltr">{m.user.email}</span>
                </div>
              </div>
              <div className="min-w-0 text-sm">
                <div className="truncate">{title || <span className="text-muted-foreground">{t("noTitle")}</span>}</div>
                <div className="truncate text-xs text-muted-foreground">{m.staffProfile?.department ? pick(locale, m.staffProfile.department.nameEn, m.staffProfile.department.nameAr) : t("noDepartment")}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {m.roles.map((r) => (
                  <Pill key={r.id} tone={r.role.key === "school_admin" ? "brand" : "neutral"}>
                    {pick(locale, r.role.nameEn, r.role.nameAr)}
                  </Pill>
                ))}
              </div>
              <div>
                <Pill tone={MEMBER_TONE[m.status]} dot>
                  {t(`memberStatus.${m.status}`)}
                </Pill>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                <EditStaffDialog
                  member={{ id: m.id, name, roleKeys: keys.filter((k) => STAFF_ROLE_KEYS.includes(k)), departmentId: m.staffProfile?.departmentId ?? null, titleEn: m.staffProfile?.jobTitleEn ?? m.titleEn ?? "", titleAr: m.staffProfile?.jobTitleAr ?? m.titleAr ?? "" }}
                  roles={roleOptions}
                  departments={deptOptions}
                  adminLock={isAdmin && m.id === ctx.membershipId ? "self" : isAdmin && m.id === lastAdminId ? "last" : !canAdminRole ? "permission" : null}
                />
                <MemberStatusButton
                  membershipId={m.id}
                  name={name}
                  status={m.status === "PENDING_APPROVAL" ? "INVITED" : m.status}
                  blocked={m.id === ctx.membershipId ? "self" : isAdmin && !canAdminRole ? "permission" : m.id === lastAdminId ? "last" : null}
                />
              </div>
            </Row>
          );
        })}
      </Table>
    );
  }

  async function studentsTab() {
    const where: Prisma.StudentWhereInput = {
      ...(statusFilter ? { status: statusFilter as PersonStatus } : {}),
      ...(grade !== null ? { gradeLevel: grade } : {}),
      ...(q
        ? { OR: [{ firstNameEn: { contains: q, mode: "insensitive" } }, { lastNameEn: { contains: q, mode: "insensitive" } }, { firstNameAr: { contains: q } }, { lastNameAr: { contains: q } }, { studentNo: { contains: q, mode: "insensitive" } }] }
        : {}),
    };
    const [students, total] = await Promise.all([
      db.student.findMany({ where, include: { _count: { select: { guardians: true } } }, orderBy: [{ gradeLevel: "asc" }, { section: "asc" }, { lastNameEn: "asc" }, { firstNameEn: "asc" }], take: LIMIT }),
      db.student.count({ where }),
    ]);
    if (students.length === 0) return <EmptyState icon={<GraduationCap className="size-5" />} title={t("emptyStudents")} body={t("emptyFiltered")} />;
    const cols = "lg:grid-cols-[120px_minmax(0,1.6fr)_110px_110px_100px]";
    return (
      <Table cols={cols} header={[t("colStudentNo"), t("colName"), t("colGrade"), t("colGuardians"), t("colStatus")]} footer={total > students.length ? t("showing", { shown: students.length, total }) : undefined}>
        {students.map((s) => (
          <Row key={s.id} cols={cols} testId="student-row">
            <div className="text-xs font-medium tabular-nums text-muted-foreground">
              <span dir="ltr">{s.studentNo}</span>
            </div>
            <div className="min-w-0">
              <Link href={`/students/${s.id}`} className="block truncate text-sm font-medium hover:text-brand">
                {personName(s, locale)}
              </Link>
              <div className="truncate text-xs text-muted-foreground">{locale === "ar" ? `${s.firstNameEn} ${s.lastNameEn}` : `${s.firstNameAr} ${s.lastNameAr}`}</div>
            </div>
            <div className="text-sm">{t("gradeSection", { grade: s.gradeLevel, section: s.section ?? "" })}</div>
            <div className="text-sm">{s._count.guardians === 0 ? <Pill tone="warning">{t("noGuardians")}</Pill> : t("guardianCount", { count: s._count.guardians })}</div>
            <div>
              <Pill tone={STUDENT_TONE[s.status]} dot>
                {t(`studentStatus.${s.status}`)}
              </Pill>
            </div>
          </Row>
        ))}
      </Table>
    );
  }

  async function familiesTab() {
    const where: Prisma.GuardianWhereInput = {
      ...(grade !== null ? { links: { some: { student: { gradeLevel: grade } } } } : {}),
      ...(q
        ? {
            OR: [
              { firstNameEn: { contains: q, mode: "insensitive" } },
              { lastNameEn: { contains: q, mode: "insensitive" } },
              { firstNameAr: { contains: q } },
              { lastNameAr: { contains: q } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { links: { some: { student: { OR: [{ firstNameEn: { contains: q, mode: "insensitive" } }, { firstNameAr: { contains: q } }, { studentNo: { contains: q, mode: "insensitive" } }] } } } },
            ],
          }
        : {}),
    };
    const [guardians, total] = await Promise.all([
      db.guardian.findMany({ where, include: { links: { include: { student: true }, orderBy: { student: { gradeLevel: "desc" } } }, membership: { select: { status: true } } }, orderBy: [{ lastNameEn: "asc" }, { firstNameEn: "asc" }], take: LIMIT }),
      db.guardian.count({ where }),
    ]);
    if (guardians.length === 0) return <EmptyState icon={<Users className="size-5" />} title={t("emptyFamilies")} body={t("emptyFiltered")} />;
    const cols = "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]";
    return (
      <Table cols={cols} header={[t("colGuardian"), t("colContact"), t("colChildren")]} footer={total > guardians.length ? t("showing", { shown: guardians.length, total }) : undefined}>
        {guardians.map((g) => (
          <Row key={g.id} cols={cols} testId="guardian-row">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{personName(g, locale)}</div>
              <div className="truncate text-xs text-muted-foreground">{locale === "ar" ? `${g.firstNameEn} ${g.lastNameEn}` : `${g.firstNameAr} ${g.lastNameAr}`}</div>
              <div className="mt-1">
                {g.membership ? (
                  <Pill tone={MEMBER_TONE[g.membership.status]}>{t(`portal.${g.membership.status}`)}</Pill>
                ) : (
                  <Pill>{t("portal.NONE")}</Pill>
                )}
              </div>
            </div>
            <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
              {g.email && (
                <a href={`mailto:${g.email}`} className="flex items-center gap-1.5 truncate hover:text-foreground">
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate" dir="ltr">
                    {g.email}
                  </span>
                </a>
              )}
              {g.phone && (
                <a href={`tel:${g.phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="size-3.5 shrink-0" />
                  <span dir="ltr">{g.phone}</span>
                </a>
              )}
              {!g.email && !g.phone && <span>{t("noContact")}</span>}
            </div>
            <ul className="space-y-1.5">
              {g.links.length === 0 && <li className="text-xs text-muted-foreground">{t("noChildren")}</li>}
              {g.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                  <Link href={`/students/${l.studentId}`} className="font-medium hover:text-brand">
                    {personName(l.student, locale)}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {pick(locale, l.relationshipEn, l.relationshipAr)} · {t("gradeSection", { grade: l.student.gradeLevel, section: l.student.section ?? "" })}
                  </span>
                  {l.isPrimary && <Pill tone="brand">{t("flagPrimary")}</Pill>}
                  {l.canApprove ? <Pill tone="success">{t("flagApprove")}</Pill> : <Pill>{t("flagNoApprove")}</Pill>}
                  {!l.receivesUpdates && <Pill tone="warning">{t("flagNoUpdates")}</Pill>}
                  <GuardianLinkDialog
                    link={{ id: l.id, isPrimary: l.isPrimary, canApprove: l.canApprove, receivesUpdates: l.receivesUpdates }}
                    guardianName={personName(g, locale)}
                    studentName={personName(l.student, locale)}
                  />
                </li>
              ))}
            </ul>
          </Row>
        ))}
      </Table>
    );
  }

  async function importsTab() {
    const imports = await db.csvImport.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const byIds = [...new Set(imports.map((i) => i.createdById))];
    const members = byIds.length ? await db.membership.findMany({ where: { id: { in: byIds } }, include: { user: true } }) : [];
    const cols = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_90px_90px_90px_110px]";
    return (
      <div className="space-y-6">
        <CsvImporter />
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t("importHistory")}</h2>
          {imports.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="size-5" />} title={t("emptyImports")} body={t("emptyImportsBody")} />
          ) : (
            <Table cols={cols} header={[t("colFile"), t("colBy"), t("colTotal"), t("colSucceeded"), t("colFailed"), t("colStatus")]}>
              {imports.map((i) => {
                const by = members.find((m) => m.id === i.createdById);
                const errors = Array.isArray(i.errors) ? (i.errors as Array<{ row: number; field: string; code: string }>) : [];
                return (
                  <div key={i.id} data-testid="import-row">
                    <Row cols={cols}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          <span dir="ltr">{i.fileName}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{fmtDateTime(prefs, i.createdAt)}</div>
                      </div>
                      <div className="truncate text-sm">{by ? userName(by.user, locale) : ""}</div>
                      <div className="text-sm tabular-nums">
                        <span className="text-xs text-muted-foreground lg:hidden">{t("colTotal")}: </span>
                        {fmtNumber(prefs, i.total)}
                      </div>
                      <div className="text-sm tabular-nums text-success">
                        <span className="text-xs text-muted-foreground lg:hidden">{t("colSucceeded")}: </span>
                        {fmtNumber(prefs, i.succeeded)}
                      </div>
                      <div className={i.failed ? "text-sm tabular-nums text-danger" : "text-sm tabular-nums"}>
                        <span className="text-xs text-muted-foreground lg:hidden">{t("colFailed")}: </span>
                        {fmtNumber(prefs, i.failed)}
                      </div>
                      <div>
                        <Pill tone={i.status === "COMPLETED" ? (i.failed ? "warning" : "success") : i.status === "FAILED" ? "danger" : "info"} dot>
                          {t(`importStatus.${i.status}`)}
                        </Pill>
                      </div>
                    </Row>
                    {errors.length > 0 && (
                      <div className="px-4 pb-3 sm:px-5">
                        <ImportErrors errors={errors} />
                      </div>
                    )}
                  </div>
                );
              })}
            </Table>
          )}
        </section>
      </div>
    );
  }
}

function Table({ cols, header, footer, endLast, children }: { cols: string; header: string[]; footer?: string; endLast?: boolean; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className={`hidden gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid ${cols}`}>
        {header.map((h, i) => (
          <span key={i} className={endLast && i === header.length - 1 ? "text-end" : undefined}>
            {h}
          </span>
        ))}
      </div>
      <div className="divide-y">{children}</div>
      {footer && <div className="border-t bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

function Row({ cols, children, testId }: { cols: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className={`grid gap-3 px-4 py-3.5 sm:px-5 lg:items-center ${cols}`} data-testid={testId}>
      {children}
    </div>
  );
}
