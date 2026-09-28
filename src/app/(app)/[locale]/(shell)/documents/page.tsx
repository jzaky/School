import type { Prisma, Sensitivity } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, Download, Eye, FileSignature, FileText, FolderOpen, Plus, TimerReset } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill, SensitivityBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { FamilyToggle, NewVersionButton, UploadDocument } from "@/components/documents/document-forms";
import { visibleStudentIds } from "@/server/access/student-access";
import { canViewCase, SENSITIVE } from "@/server/access/case-access";

export async function generateMetadata() {
  const t = await getTranslations("documents");
  return { title: t("title") };
}

const DAY = 86400000;

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; category?: string; q?: string; student?: string; case?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("documents");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const now = new Date();
  const q = sp.q?.trim();
  const tab = sp.tab ?? "all";
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;

  // A case context shows that case's documents, including sensitive ones, only through the case access module.
  const caseRow = sp.case && ctx.isStaff ? await db.case.findUnique({ where: { id: sp.case }, include: { student: true } }) : null;
  const caseOk = caseRow ? await canViewCase(ctx, caseRow, { action: "case.documents_view" }) : false;

  let scope: Prisma.DocumentWhereInput;
  if (!ctx.isStaff) {
    const ids = (await visibleStudentIds(ctx)) ?? [];
    scope = { visibleToFamily: true, studentId: { in: ids } };
  } else if (caseRow && caseOk) {
    scope = { caseId: caseRow.id };
  } else {
    const allowed: Sensitivity[] = ["STANDARD"];
    if (ctx.can("documents.sensitive") || ctx.can("documents.manage") || ctx.can("people.reveal_ids")) allowed.push("CONFIDENTIAL");
    if (ctx.can("people.medical") || ctx.can("documents.sensitive")) allowed.push("MEDICAL");
    scope = {
      AND: [
        { sensitivity: { notIn: SENSITIVE } },
        ctx.can("documents.view") ? { OR: [{ sensitivity: { in: allowed } }, { uploadedById: ctx.membershipId }] } : { uploadedById: ctx.membershipId },
      ],
    };
  }
  const studentFilter: Prisma.DocumentWhereInput = sp.student && !caseRow ? { studentId: sp.student } : {};
  const tabWhere: Prisma.DocumentWhereInput =
    tab === "generated" ? { source: "GENERATED" } : tab === "uploads" ? { source: "UPLOAD" } : tab === "expiring" ? { expiresAt: { gte: now, lt: new Date(now.getTime() + 60 * DAY) } } : {};
  const catWhere: Prisma.DocumentWhereInput = sp.category ? { category: { key: sp.category } } : {};
  const searchWhere: Prisma.DocumentWhereInput = q ? { OR: [{ titleEn: { contains: q, mode: "insensitive" } }, { titleAr: { contains: q } }] } : {};
  const where: Prisma.DocumentWhereInput = { AND: [scope, studentFilter, tabWhere, catWhere, searchWhere] };

  const [docs, categories, counts] = await Promise.all([
    db.document.findMany({ where, include: { category: true, versions: { orderBy: { version: "desc" } } }, orderBy: { updatedAt: "desc" }, take: 80 }),
    db.documentCategory.findMany({ orderBy: { nameEn: "asc" } }),
    Promise.all([
      db.document.count({ where: { AND: [scope, studentFilter] } }),
      db.document.count({ where: { AND: [scope, studentFilter, { source: "GENERATED", createdAt: { gte: new Date(now.getTime() - 30 * DAY) } }] } }),
      db.document.count({ where: { AND: [scope, studentFilter, { expiresAt: { gte: now, lt: new Date(now.getTime() + 60 * DAY) } }] } }),
    ]),
  ]);
  const studentIds = [...new Set(docs.map((d) => d.studentId).filter(Boolean) as string[])];
  const canUpload = ctx.isStaff && (ctx.can("documents.manage") || ctx.can("documents.view"));
  const [students, pickerStudents, uploaders] = await Promise.all([
    db.student.findMany({ where: { id: { in: studentIds } } }),
    canUpload && !caseRow ? db.student.findMany({ where: { status: "ACTIVE" }, orderBy: [{ gradeLevel: "asc" }, { lastNameEn: "asc" }], take: 400 }) : Promise.resolve([]),
    db.membership.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.uploadedById))] } }, include: { user: true } }),
  ]);
  const filterStudent = sp.student ? (students.find((s) => s.id === sp.student) ?? (await db.student.findUnique({ where: { id: sp.student } }))) : null;
  const visibleCats = categories.filter((c) => !SENSITIVE.includes(c.sensitivity));

  const studentOptions = pickerStudents.map((s) => ({ value: s.id, label: personName(s, locale), hint: t("grade", { grade: s.gradeLevel }), keywords: `${s.firstNameEn} ${s.lastNameEn} ${s.firstNameAr} ${s.lastNameAr} ${s.studentNo}` }));
  const caseLabel = caseRow && caseOk ? `${caseRow.number} · ${personName(caseRow.student, locale)}` : undefined;
  const uploadCategories = (caseRow ? categories : visibleCats).map((c) => ({ id: c.id, label: pick(locale, c.nameEn, c.nameAr), sensitive: c.sensitivity !== "STANDARD" }));

  return (
    <PageBody>
      {caseRow && (
        <Link href={`/cases/${caseRow.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Back className="size-4" />
          {t("backToCase")}
        </Link>
      )}
      <PageHeader
        title={caseLabel ? t("caseTitle", { case: caseLabel }) : filterStudent ? t("studentTitle", { name: personName(filterStudent, locale) }) : t("title")}
        description={ctx.isStaff ? t("subtitle") : t("subtitleFamily")}
        actions={
          ctx.isStaff ? (
            canUpload && (!caseRow || caseOk) ? (
              <UploadDocument categories={uploadCategories} students={studentOptions} defaultStudentId={sp.student} caseId={caseOk ? caseRow?.id : undefined} caseLabel={caseLabel} canShare={ctx.can("documents.manage")} />
            ) : null
          ) : (
            <Button asChild>
              <Link href="/services/document_request">
                <Plus className="size-4" />
                {t("requestLetter")}
              </Link>
            </Button>
          )
        }
      />
      {caseRow && !caseOk ? (
        <EmptyState icon={<FolderOpen className="size-5" />} title={t("noAccess")} body={t("noAccessBody")} />
      ) : (
        <>
          {ctx.isStaff && !caseRow && (
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label={t("statTotal")} value={fmtNumber(prefs, counts[0])} icon={<FileText className="size-4" />} />
              <StatCard label={t("statGenerated")} value={fmtNumber(prefs, counts[1])} icon={<FileSignature className="size-4" />} />
              <StatCard label={t("statExpiring")} value={fmtNumber(prefs, counts[2])} icon={<TimerReset className="size-4" />} tone={counts[2] ? "warning" : undefined} />
            </div>
          )}
          <FilterBar
            tabs={[
              { value: "all", label: t("tabAll") },
              { value: "generated", label: t("tabGenerated") },
              ...(ctx.isStaff ? [{ value: "uploads", label: t("tabUploads") }, { value: "expiring", label: t("tabExpiring"), count: counts[2] }] : []),
            ]}
            searchPlaceholder={t("search")}
          />
          {!caseRow && <FilterBar chips={[{ value: "", label: t("allCategories") }, ...visibleCats.map((c) => ({ value: c.key, label: pick(locale, c.nameEn, c.nameAr) }))]} chipParam="category" />}
          {docs.length === 0 ? (
            <EmptyState icon={<FolderOpen className="size-5" />} title={t("empty")} body={ctx.isStaff ? t("emptyBody") : t("emptyFamily")} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="hidden grid-cols-[minmax(0,1fr)_180px_130px_110px_120px] gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
                <span>{t("colDocument")}</span>
                <span>{ctx.isStaff ? t("colStudent") : t("colFor")}</span>
                <span>{t("colUpdated")}</span>
                <span>{ctx.can("documents.manage") ? t("colFamily") : ""}</span>
                <span className="text-end">{t("colActions")}</span>
              </div>
              <ul className="divide-y">
                {docs.map((d) => {
                  const v = d.versions.find((x) => x.id === d.currentVersionId) ?? d.versions[0];
                  const student = students.find((s) => s.id === d.studentId);
                  const uploader = uploaders.find((m) => m.id === d.uploadedById);
                  const daysLeft = d.expiresAt ? Math.ceil((d.expiresAt.getTime() - now.getTime()) / DAY) : null;
                  return (
                    <li key={d.id} className="grid gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_180px_130px_110px_120px] lg:items-center" data-testid="document-row">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={d.source === "GENERATED" ? "grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" : "grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"}>
                          {d.source === "GENERATED" ? <FileSignature className="size-4" /> : <FileText className="size-4" />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{pick(locale, d.titleEn, d.titleAr)}</span>
                            <SensitivityBadge sensitivity={d.sensitivity} />
                            {daysLeft !== null && daysLeft <= 60 && <Pill tone={daysLeft < 0 ? "danger" : "warning"}>{daysLeft < 0 ? t("expired") : t("expiresIn", { days: daysLeft })}</Pill>}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            {d.category && <span>{pick(locale, d.category.nameEn, d.category.nameAr)}</span>}
                            <span>· {d.source === "GENERATED" ? t("generated") : t("uploadedBy", { name: uploader ? pick(locale, uploader.user.nameEn, uploader.user.nameAr) : "" })}</span>
                            {v && d.versions.length > 1 && <span>· {t("version", { version: v.version })}</span>}
                            {v && d.source === "UPLOAD" && <span dir="ltr">· {sizeLabel(v.sizeBytes)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="truncate text-sm">
                        {student ? (
                          ctx.isStaff ? (
                            <Link href={`/students/${student.id}`} className="hover:text-brand">
                              {personName(student, locale)}
                            </Link>
                          ) : (
                            personName(student, locale)
                          )
                        ) : (
                          <span className="text-muted-foreground">{t("schoolWide")}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{fmtDate(prefs, d.updatedAt)}</div>
                      <div>{ctx.can("documents.manage") && d.studentId && <FamilyToggle documentId={d.id} visible={d.visibleToFamily} blocked={d.sensitivity !== "STANDARD"} />}</div>
                      <div className="flex items-center gap-1 lg:justify-end">
                        {v && (
                          <>
                            <a href={`/api/documents/${d.id}/download?inline=1`} target="_blank" rel="noreferrer" aria-label={t("view")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="document-view">
                              <Eye className="size-4" />
                            </a>
                            <a href={`/api/documents/${d.id}/download`} aria-label={t("download")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <Download className="size-4" />
                            </a>
                          </>
                        )}
                        {ctx.isStaff && d.source === "UPLOAD" && (ctx.can("documents.manage") || d.uploadedById === ctx.membershipId) && <NewVersionButton documentId={d.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </PageBody>
  );
}
