// Grade writes: assessments, scores, publishing (with one notification per assessment and student) and bands.
// Server actions wrap these; tests call them directly with a viewer.
import type { AssessmentKind } from "@prisma/client";
import { tenantTx, type TenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { validateBands, type Band } from "./calc";
import { classScope, type GradeViewer } from "./queries";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const ASSESSMENT_KINDS: AssessmentKind[] = ["HOMEWORK", "QUIZ", "TEST", "EXAM", "PROJECT", "COURSEWORK", "PARTICIPATION"];

export const GRADE_TEMPLATE = {
  key: "grade_published",
  subjectEn: "New grade published: {{assessment}}",
  subjectAr: "تم نشر درجة جديدة: {{assessment}}",
  bodyEn: "{{student}} has a new published grade in {{subject}}: {{assessment}}. Open Horizon to see the result.",
  bodyAr: "نُشرت درجة جديدة لـ {{student}} في مادة {{subject}}: {{assessment}}. افتح منصة هورايزن للاطلاع على النتيجة.",
};

/** Make sure the bilingual template exists so notifications always have proper text. */
export async function ensureGradeTemplate(tx: TenantTx, orgId: string) {
  await tx.messageTemplate.upsert({
    where: { orgId_key_channel: { orgId, key: GRADE_TEMPLATE.key, channel: "EMAIL" } },
    create: { orgId, key: GRADE_TEMPLATE.key, channel: "EMAIL", subjectEn: GRADE_TEMPLATE.subjectEn, subjectAr: GRADE_TEMPLATE.subjectAr, bodyEn: GRADE_TEMPLATE.bodyEn, bodyAr: GRADE_TEMPLATE.bodyAr },
    update: {},
  });
}

/** The class, when this member may edit its grades. */
async function editableClass(v: GradeViewer, classId: string) {
  if (!v.can("grades.enter")) return null;
  const scope = await classScope(v);
  if (!scope) return null;
  const cls = await v.db.schoolClass.findFirst({ where: { AND: [scope.where, { id: classId }] }, include: { subject: true, academicYear: { include: { terms: true } } } });
  if (!cls) return null;
  const ok = cls.teacherMembershipId === v.membershipId || (!!cls.subject?.departmentId && scope.departments.includes(cls.subject.departmentId));
  return ok ? cls : null;
}

async function editableAssessment(v: GradeViewer, assessmentId: string) {
  const a = await v.db.assessment.findUnique({ where: { id: assessmentId } });
  if (!a) return null;
  const cls = await editableClass(v, a.classId);
  return cls ? { a, cls } : null;
}

export type AssessmentInput = {
  titleEn: string;
  titleAr: string;
  kind: AssessmentKind;
  maxScore: number;
  weight: number;
  dueAt: string | null;
  termId: string | null;
};

function checkAssessment(input: AssessmentInput, termIds: string[]): string | null {
  if (!input.titleEn.trim() || input.titleEn.length > 120) return "title";
  if (input.titleAr.length > 120) return "title";
  if (!ASSESSMENT_KINDS.includes(input.kind)) return "kind";
  if (!Number.isFinite(input.maxScore) || input.maxScore <= 0 || input.maxScore > 1000) return "maxScore";
  if (!Number.isFinite(input.weight) || input.weight <= 0 || input.weight > 100) return "weight";
  if (input.dueAt && Number.isNaN(new Date(input.dueAt).getTime())) return "dueAt";
  if (input.termId && !termIds.includes(input.termId)) return "term";
  return null;
}

export async function createAssessment(v: GradeViewer, classId: string, input: AssessmentInput): Promise<Result<{ id: string }>> {
  const cls = await editableClass(v, classId);
  if (!cls) return { ok: false, error: "forbidden" };
  const err = checkAssessment(input, cls.academicYear.terms.map((t) => t.id));
  if (err) return { ok: false, error: err };
  const row = await v.db.assessment.create({
    data: {
      orgId: v.orgId,
      classId,
      termId: input.termId,
      titleEn: input.titleEn.trim(),
      titleAr: input.titleAr.trim() || input.titleEn.trim(),
      kind: input.kind,
      maxScore: input.maxScore,
      weight: input.weight,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdById: v.membershipId,
    },
  });
  await audit(v.db, v.orgId, { actorId: v.membershipId, action: "grades.assessment_create", entityType: "Assessment", entityId: row.id, meta: { classId } });
  return { ok: true, id: row.id };
}

export async function updateAssessment(v: GradeViewer, assessmentId: string, input: AssessmentInput): Promise<Result> {
  const found = await editableAssessment(v, assessmentId);
  if (!found) return { ok: false, error: "forbidden" };
  const err = checkAssessment(input, found.cls.academicYear.terms.map((t) => t.id));
  if (err) return { ok: false, error: err };
  const maxGrade = await v.db.grade.findFirst({ where: { assessmentId, score: { gt: input.maxScore } }, select: { id: true } });
  if (maxGrade) return { ok: false, error: "maxBelowScores" };
  await v.db.assessment.update({
    where: { id: assessmentId },
    data: { titleEn: input.titleEn.trim(), titleAr: input.titleAr.trim() || input.titleEn.trim(), kind: input.kind, maxScore: input.maxScore, weight: input.weight, dueAt: input.dueAt ? new Date(input.dueAt) : null, termId: input.termId },
  });
  await audit(v.db, v.orgId, { actorId: v.membershipId, action: "grades.assessment_update", entityType: "Assessment", entityId: assessmentId });
  return { ok: true };
}

export async function deleteAssessment(v: GradeViewer, assessmentId: string): Promise<Result> {
  const found = await editableAssessment(v, assessmentId);
  if (!found) return { ok: false, error: "forbidden" };
  if (found.a.publishedAt) return { ok: false, error: "publishedDelete" };
  await v.db.assessment.delete({ where: { id: assessmentId } });
  await audit(v.db, v.orgId, { actorId: v.membershipId, action: "grades.assessment_delete", entityType: "Assessment", entityId: assessmentId, meta: { classId: found.a.classId } });
  return { ok: true };
}

export type CellInput = { assessmentId: string; studentId: string; score?: number | null; excused?: boolean; comment?: string | null };

/** Save a batch of grade cells for one class. Every cell is checked against the class and the assessment's maximum. */
export async function saveGrades(v: GradeViewer, classId: string, cells: CellInput[], locale: "en" | "ar"): Promise<Result<{ saved: number; rejected: Array<{ assessmentId: string; studentId: string; error: string }> }>> {
  if (!cells.length) return { ok: true, saved: 0, rejected: [] };
  if (cells.length > 2000) return { ok: false, error: "tooMany" };
  const cls = await editableClass(v, classId);
  if (!cls) return { ok: false, error: "forbidden" };
  const [assessments, enrollments] = await Promise.all([
    v.db.assessment.findMany({ where: { classId, id: { in: [...new Set(cells.map((c) => c.assessmentId))] } } }),
    v.db.enrollment.findMany({ where: { classId, status: "ACTIVE" }, select: { studentId: true } }),
  ]);
  const enrolled = new Set(enrollments.map((e) => e.studentId));
  const rejected: Array<{ assessmentId: string; studentId: string; error: string }> = [];
  const valid: CellInput[] = [];
  for (const c of cells) {
    const a = assessments.find((x) => x.id === c.assessmentId);
    if (!a || !enrolled.has(c.studentId)) {
      rejected.push({ assessmentId: c.assessmentId, studentId: c.studentId, error: "forbidden" });
      continue;
    }
    if (c.score !== undefined && c.score !== null && (!Number.isFinite(c.score) || c.score < 0 || c.score > a.maxScore)) {
      rejected.push({ assessmentId: c.assessmentId, studentId: c.studentId, error: "range" });
      continue;
    }
    if (c.comment && c.comment.length > 500) {
      rejected.push({ assessmentId: c.assessmentId, studentId: c.studentId, error: "comment" });
      continue;
    }
    valid.push(c);
  }
  if (valid.length) {
    await tenantTx(
      v.orgId,
      async (tx) => {
        for (const c of valid) {
          const data: { score?: number | null; excused?: boolean; commentEn?: string | null; commentAr?: string | null; updatedById: string } = { updatedById: v.membershipId };
          if (c.score !== undefined) data.score = c.score;
          if (c.excused !== undefined) data.excused = c.excused;
          if (c.comment !== undefined) {
            const text = c.comment?.trim() || null;
            if (locale === "ar") data.commentAr = text;
            else data.commentEn = text;
          }
          await tx.grade.upsert({
            where: { assessmentId_studentId: { assessmentId: c.assessmentId, studentId: c.studentId } },
            create: { orgId: v.orgId, assessmentId: c.assessmentId, studentId: c.studentId, ...data },
            update: data,
          });
        }
        await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.save", entityType: "SchoolClass", entityId: classId, meta: { cells: valid.length } });
      },
      { timeout: 30000 },
    );
  }
  return { ok: true, saved: valid.length, rejected };
}

/**
 * Publish or unpublish an assessment. Publishing notifies each enrolled student and their guardians once:
 * the idempotency key is per assessment and student, so publishing again never notifies twice.
 */
export async function setPublished(v: GradeViewer, assessmentId: string, publish: boolean, now = new Date()): Promise<Result<{ notified: number; effects: Effect[] }>> {
  const found = await editableAssessment(v, assessmentId);
  if (!found) return { ok: false, error: "forbidden" };
  const { a, cls } = found;
  const effects: Effect[] = [];
  let notified = 0;
  await tenantTx(
    v.orgId,
    async (tx) => {
      await tx.assessment.update({ where: { id: a.id }, data: { publishedAt: publish ? (a.publishedAt ?? now) : null } });
      await audit(tx, v.orgId, { actorId: v.membershipId, action: publish ? "grades.publish" : "grades.unpublish", entityType: "Assessment", entityId: a.id, meta: { classId: a.classId } });
      if (!publish) return;
      await ensureGradeTemplate(tx, v.orgId);
      const enrollments = await tx.enrollment.findMany({
        where: { classId: a.classId, status: "ACTIVE", student: { status: "ACTIVE" } },
        include: { student: { include: { guardians: { where: { receivesUpdates: true }, include: { guardian: { select: { membershipId: true } } } } } } },
      });
      const hrefFor = (sid: string) => `/grades?student=${sid}&assessment=${a.id}`;
      const already = await tx.notification.findMany({ where: { orgId: v.orgId, kind: GRADE_TEMPLATE.key, href: { in: enrollments.map((e) => hrefFor(e.studentId)) } }, select: { recipientId: true, href: true } });
      const sent = new Set(already.map((n) => `${n.href}|${n.recipientId}`));
      const ec = execCtx(tx, v.orgId, { effects, now, actorId: v.membershipId });
      for (const e of enrollments) {
        const s = e.student;
        const href = hrefFor(s.id);
        const recipients = [s.membershipId, ...s.guardians.map((g) => g.guardian.membershipId)].filter((m): m is string => !!m && !sent.has(`${href}|${m}`));
        if (!recipients.length) continue;
        const res = await notify(ec, {
          recipients,
          templateKey: GRADE_TEMPLATE.key,
          vars: {
            assessment: { en: a.titleEn, ar: a.titleAr },
            subject: { en: cls.subject?.nameEn ?? cls.nameEn, ar: cls.subject?.nameAr ?? cls.nameAr },
            student: { en: s.firstNameEn, ar: s.firstNameAr || s.firstNameEn },
          },
          href,
          kind: GRADE_TEMPLATE.key,
          idempotencyBase: `grade:${a.id}:${s.id}`,
        });
        notified += res.inApp;
      }
    },
    { timeout: 60000 },
  );
  return { ok: true, notified, effects };
}

export async function saveBands(v: GradeViewer, bands: Band[]): Promise<Result> {
  if (!v.can("school.manage")) return { ok: false, error: "forbidden" };
  const clean = bands.map((b) => ({ label: b.label.trim(), minPercent: Number(b.minPercent) }));
  const err = validateBands(clean);
  if (err) return { ok: false, error: err };
  await tenantTx(v.orgId, async (tx) => {
    await tx.gradeBand.deleteMany({ where: { orgId: v.orgId } });
    await tx.gradeBand.createMany({ data: clean.sort((a, b) => b.minPercent - a.minPercent).map((b, i) => ({ orgId: v.orgId, label: b.label, minPercent: b.minPercent, sortOrder: i })) });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.bands_update", entityType: "GradeBand", meta: { bands: clean } });
  });
  return { ok: true };
}
