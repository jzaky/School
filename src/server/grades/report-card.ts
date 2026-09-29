// Term report cards: a snapshot of a student's published grades for one term, stored as a GENERATED
// Document so it appears in /documents. The PDF is rendered from the snapshot on download.
import type { TenantDb } from "@/lib/tenant-db";
import { tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { round1 } from "./calc";
import { canUseGradebook, classScope, publishedGradesFor, termHasPublished, type GradeViewer } from "./queries";

export type ReportCardRow = {
  subjectEn: string;
  subjectAr: string;
  teacherEn: string;
  teacherAr: string;
  average: number | null;
  band: string | null;
  commentEn: string;
  commentAr: string;
};

export type ReportCardData = {
  kind: "report_card";
  school: { en: string; ar: string };
  student: { en: string; ar: string; studentNo: string; grade: number; section: string | null };
  year: { en: string; ar: string };
  term: { en: string; ar: string };
  issuedAt: string;
  rows: ReportCardRow[];
  overall: number | null;
  overallBand: string | null;
  bands: Array<{ label: string; minPercent: number }>;
};

export const REPORT_KEY_PREFIX = "reportcard:";

/** A short default comment from the average, used when the teacher has not written one. */
export function bandComment(avg: number | null): { en: string; ar: string } {
  if (avg === null) return { en: "No published assessments yet this term.", ar: "لا توجد تقييمات منشورة بعد في هذا الفصل." };
  if (avg >= 80) return { en: "Excellent work this term. Keep up the consistent effort.", ar: "عمل ممتاز في هذا الفصل. استمر في هذا الجهد المتواصل." };
  if (avg >= 70) return { en: "Good progress with secure understanding. Aim for more depth in extended tasks.", ar: "تقدم جيد وفهم راسخ. اسعَ إلى مزيد من العمق في المهام المطولة." };
  if (avg >= 60) return { en: "Steady progress. Regular revision will help consolidate key topics.", ar: "تقدم مطّرد. ستساعد المراجعة المنتظمة على ترسيخ الموضوعات الأساسية." };
  if (avg >= 50) return { en: "Some progress this term. Support sessions are recommended.", ar: "تقدم محدود في هذا الفصل، ويُنصح بحضور حصص الدعم." };
  return { en: "Needs support to meet expectations. Please speak with the subject teacher.", ar: "يحتاج إلى دعم لبلوغ المستوى المتوقع. يُرجى التواصل مع معلم المادة." };
}

/** Whether this member may create a report card for this student and term. Staff any time; families once the term has published grades. */
export async function canCreateReportCard(v: GradeViewer, studentId: string, termId: string) {
  if (v.isStudent || v.isParent) {
    if (!v.can("grades.view_own") || !v.familyStudentIds.includes(studentId)) return false;
    return termHasPublished(v.db, studentId, termId);
  }
  if (!canUseGradebook(v)) return false;
  const scope = await classScope(v);
  if (!scope) return false;
  const n = await v.db.enrollment.count({ where: { studentId, status: "ACTIVE", class: scope.where } });
  return n > 0;
}

export async function buildReportCard(db: TenantDb, studentId: string, termId: string, now = new Date()): Promise<ReportCardData | null> {
  const [data, org] = await Promise.all([publishedGradesFor(db, studentId, termId), db.organization.findFirst({ select: { nameEn: true, nameAr: true } })]);
  if (!data || !data.term) return null;
  const year = await db.academicYear.findUnique({ where: { id: data.term.academicYearId } });
  const rows: ReportCardRow[] = data.subjects.map((s) => {
    const fallback = bandComment(s.average);
    const withComment = [...s.assessments].reverse().find((a) => a.commentEn || a.commentAr);
    return {
      subjectEn: s.subject.en,
      subjectAr: s.subject.ar,
      teacherEn: s.teacher?.en ?? "",
      teacherAr: s.teacher?.ar ?? "",
      average: s.average === null ? null : round1(s.average),
      band: s.band,
      commentEn: withComment?.commentEn || fallback.en,
      commentAr: withComment?.commentAr || fallback.ar,
    };
  });
  const st = data.student;
  return {
    kind: "report_card",
    school: { en: org?.nameEn ?? "", ar: org?.nameAr ?? org?.nameEn ?? "" },
    student: { en: `${st.firstNameEn} ${st.lastNameEn}`, ar: `${st.firstNameAr || st.firstNameEn} ${st.lastNameAr || st.lastNameEn}`, studentNo: st.studentNo, grade: st.gradeLevel, section: st.section },
    year: { en: year?.nameEn ?? "", ar: year?.nameAr ?? "" },
    term: { en: data.term.nameEn, ar: data.term.nameAr },
    issuedAt: now.toISOString(),
    rows,
    overall: data.overall === null ? null : round1(data.overall),
    overallBand: data.overallBand,
    bands: data.bands,
  };
}

/** Create (or add a new version to) the student's report card document for a term. */
export async function generateReportCard(v: GradeViewer, studentId: string, termId: string): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  if (!(await canCreateReportCard(v, studentId, termId))) return { ok: false, error: "forbidden" };
  const data = await buildReportCard(v.db, studentId, termId);
  if (!data) return { ok: false, error: "notFound" };
  const storageKey = `${REPORT_KEY_PREFIX}${termId}:${studentId}`;
  const category = await v.db.documentCategory.findFirst({ where: { key: "reports" }, select: { id: true } });
  const fileName = `report-card-${data.student.studentNo}-${data.term.en.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  const documentId = await tenantTx(v.orgId, async (tx) => {
    const existing = await tx.document.findFirst({ where: { studentId, source: "GENERATED", versions: { some: { storageKey } } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    const doc =
      existing ??
      (await tx.document.create({
        data: {
          orgId: v.orgId,
          categoryId: category?.id ?? null,
          titleEn: `Term report card: ${data.term.en} ${data.year.en}`,
          titleAr: `بطاقة التقرير الفصلي: ${data.term.ar} ${data.year.ar}`,
          studentId,
          sensitivity: "STANDARD",
          source: "GENERATED",
          uploadedById: v.membershipId,
          visibleToFamily: true,
        },
      }));
    const version = await tx.documentVersion.create({
      data: {
        orgId: v.orgId,
        documentId: doc.id,
        version: (existing?.versions[0]?.version ?? 0) + 1,
        storageKey,
        fileName,
        mimeType: "application/pdf",
        sizeBytes: 0,
        renderData: data as never,
        output: "BILINGUAL",
        createdById: v.membershipId,
      },
    });
    await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.report_card", entityType: "Document", entityId: doc.id, meta: { termId, version: version.version } });
    return doc.id;
  });
  return { ok: true, documentId };
}
