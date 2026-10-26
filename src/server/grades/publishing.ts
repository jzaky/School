// Grade publishing by a publisher ("Teachers submit, a publisher releases").
// - The school chooses the mode (school.manage). In PUBLISHER mode teachers mark an assessment Ready; holders of
//   grades.publish (the Head of IT by default) see a publishing queue by class, assessment and teacher and publish
//   one, several or all. Publishing notifies families exactly as a teacher's publish does. Publish and unpublish
//   are audited.
// - Report cards follow the same rule: in PUBLISHER mode a report card made by staff stays hidden from the family
//   until a publisher releases it, and families cannot make their own.
// The publisher sees completeness (how many students have a mark), never the scores themselves.
import type { GradePublishMode, Prisma } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { editableAssessment, notifyPublished, type Result } from "./service";
import { publishModeOf } from "./publish-mode";
import { REPORT_KEY_PREFIX } from "./report-card";
import type { GradeViewer } from "./queries";

export { publishModeOf };

export const QUEUE_PAGE = 25;
const MAX_BATCH = 200;

export const REPORT_RELEASE_TEMPLATE = {
  key: "report_card_released",
  subjectEn: "Report card ready: {{student}}",
  subjectAr: "بطاقة التقرير جاهزة: {{student}}",
  bodyEn: "The {{term}} report card for {{student}} has been released. Open Horizon to read it.",
  bodyAr: "صدرت بطاقة تقرير {{term}} للطالب/ة {{student}}. افتح منصة هورايزن للاطلاع عليها.",
};

export async function setPublishMode(v: GradeViewer, mode: GradePublishMode): Promise<Result> {
  if (!v.can("school.manage")) return { ok: false, error: "forbidden" };
  if (mode !== "TEACHER" && mode !== "PUBLISHER") return { ok: false, error: "invalid" };
  const before = await publishModeOf(v.db);
  if (before === mode) return { ok: true };
  await tenantTx(v.orgId, async (tx) => {
    await tx.gradeSettings.upsert({ where: { orgId: v.orgId }, create: { orgId: v.orgId, publishMode: mode, updatedById: v.membershipId }, update: { publishMode: mode, updatedById: v.membershipId } });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.publish_mode", entityType: "GradeSettings", meta: { from: before, to: mode } });
  });
  return { ok: true };
}

/** A teacher marks an assessment ready for the publisher, or takes it back. PUBLISHER mode only. */
export async function setReady(v: GradeViewer, assessmentId: string, ready: boolean, now = new Date()): Promise<Result> {
  const found = await editableAssessment(v, assessmentId);
  if (!found) return { ok: false, error: "forbidden" };
  if ((await publishModeOf(v.db)) !== "PUBLISHER") return { ok: false, error: "teacherMode" };
  if (found.a.publishedAt) return { ok: false, error: "alreadyPublished" };
  if (Boolean(found.a.readyAt) === ready) return { ok: true };
  await tenantTx(v.orgId, async (tx) => {
    await tx.assessment.update({ where: { id: assessmentId }, data: ready ? { readyAt: now, readyById: v.membershipId } : { readyAt: null, readyById: null } });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: ready ? "grades.ready" : "grades.ready_withdrawn", entityType: "Assessment", entityId: assessmentId, meta: { classId: found.a.classId } });
  });
  return { ok: true };
}

export const canPublish = (v: Pick<GradeViewer, "can" | "isStudent" | "isParent">) => !v.isStudent && !v.isParent && v.can("grades.publish");

export type QueueFilter = { status?: "ready" | "published" | "waiting"; classId?: string | null; teacherId?: string | null; page?: number };

function statusWhere(status: QueueFilter["status"]): Prisma.AssessmentWhereInput {
  if (status === "published") return { publishedAt: { not: null } };
  if (status === "waiting") return { readyAt: null, publishedAt: null };
  return { readyAt: { not: null }, publishedAt: null };
}

/** The publishing queue for grades.publish holders: assessments by class and teacher, with completeness. */
export async function publishQueue(v: GradeViewer, f: QueueFilter) {
  if (!canPublish(v)) return null;
  const mode = await publishModeOf(v.db);
  const clsWhere: Prisma.SchoolClassWhereInput = { isHomeroom: false, academicYear: { isCurrent: true }, ...(f.teacherId ? { teacherMembershipId: f.teacherId } : {}) };
  const classes = await v.db.schoolClass.findMany({ where: clsWhere, select: { id: true, nameEn: true, nameAr: true, gradeLevel: true, teacherMembershipId: true, subject: { select: { nameEn: true, nameAr: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } } });
  const classIds = classes.map((c) => c.id);
  const scoped: Prisma.AssessmentWhereInput = { ...statusWhere(f.status), classId: f.classId ? (classIds.includes(f.classId) ? f.classId : "none") : { in: classIds } };
  const page = Math.max(1, Math.min(1000, f.page ?? 1));
  const order: Prisma.AssessmentOrderByWithRelationInput[] = f.status === "published" ? [{ publishedAt: "desc" }] : [{ readyAt: "asc" }, { createdAt: "asc" }];
  const [rows, total, readyCount, waitingCount, readyByClass] = await Promise.all([
    v.db.assessment.findMany({ where: scoped, orderBy: order, skip: (page - 1) * QUEUE_PAGE, take: QUEUE_PAGE, select: { id: true, classId: true, titleEn: true, titleAr: true, kind: true, maxScore: true, dueAt: true, readyAt: true, readyById: true, publishedAt: true, publishedById: true, createdById: true } }),
    v.db.assessment.count({ where: scoped }),
    v.db.assessment.count({ where: { classId: { in: classIds }, readyAt: { not: null }, publishedAt: null } }),
    v.db.assessment.count({ where: { classId: { in: classIds }, readyAt: null, publishedAt: null } }),
    v.db.assessment.groupBy({ by: ["classId"], where: { classId: { in: classIds }, readyAt: { not: null }, publishedAt: null }, _count: { _all: true } }),
  ]);
  const marked = rows.length ? await v.db.grade.groupBy({ by: ["assessmentId"], where: { assessmentId: { in: rows.map((r) => r.id) }, OR: [{ score: { not: null } }, { excused: true }] }, _count: { _all: true } }) : [];
  const people = [...new Set([...rows.flatMap((r) => [r.readyById, r.publishedById, r.createdById]), ...classes.map((c) => c.teacherMembershipId)].filter(Boolean) as string[])];
  const names = people.length ? await v.db.membership.findMany({ where: { id: { in: people } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [];
  const nm = (id: string | null) => {
    const m = names.find((x) => x.id === id);
    return m ? { en: m.user.nameEn, ar: m.user.nameAr ?? m.user.nameEn } : null;
  };
  const teachersWithReady = [...new Set(classes.filter((c) => readyByClass.some((r) => r.classId === c.id)).map((c) => c.teacherMembershipId).filter(Boolean) as string[])];
  return {
    mode,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / QUEUE_PAGE)),
    readyCount,
    waitingCount,
    rows: rows.map((r) => {
      const c = classes.find((x) => x.id === r.classId)!;
      return {
        ...r,
        cls: { id: c.id, en: c.nameEn, ar: c.nameAr, gradeLevel: c.gradeLevel, subject: c.subject ? { en: c.subject.nameEn, ar: c.subject.nameAr } : null },
        teacher: nm(c.teacherMembershipId),
        readyBy: nm(r.readyById),
        publishedBy: nm(r.publishedById),
        students: c._count.enrollments,
        marked: marked.find((m) => m.assessmentId === r.id)?._count._all ?? 0,
      };
    }),
    classOptions: classes.filter((c) => readyByClass.some((r) => r.classId === c.id)).map((c) => ({ id: c.id, en: c.nameEn, ar: c.nameAr, gradeLevel: c.gradeLevel, ready: readyByClass.find((r) => r.classId === c.id)?._count._all ?? 0 })),
    teacherOptions: teachersWithReady.map((id) => ({ id, name: nm(id)! })).filter((x) => x.name),
  };
}

/**
 * Publish ready assessments (ids, or every ready one matching a filter, at most 200 per call). Each assessment
 * notifies its families once; a publish of something already published changes nothing.
 */
export async function publishReady(v: GradeViewer, input: { ids?: string[]; all?: { classId?: string | null; teacherId?: string | null } }, now = new Date()): Promise<Result<{ published: number; notified: number; remaining: number; effects: Effect[] }>> {
  if (!canPublish(v)) return { ok: false, error: "forbidden" };
  if ((await publishModeOf(v.db)) !== "PUBLISHER") return { ok: false, error: "teacherMode" };
  const clsWhere: Prisma.SchoolClassWhereInput = { isHomeroom: false, academicYear: { isCurrent: true }, ...(input.all?.teacherId ? { teacherMembershipId: input.all.teacherId } : {}), ...(input.all?.classId ? { id: input.all.classId } : {}) };
  const classes = await v.db.schoolClass.findMany({ where: clsWhere, select: { id: true, nameEn: true, nameAr: true, subject: { select: { nameEn: true, nameAr: true } } } });
  const where: Prisma.AssessmentWhereInput = { classId: { in: classes.map((c) => c.id) }, readyAt: { not: null }, publishedAt: null, ...(input.ids ? { id: { in: input.ids.slice(0, MAX_BATCH) } } : {}) };
  if (!input.ids && !input.all) return { ok: false, error: "invalid" };
  const targets = await v.db.assessment.findMany({ where, orderBy: { readyAt: "asc" }, take: MAX_BATCH, select: { id: true, classId: true, titleEn: true, titleAr: true } });
  const effects: Effect[] = [];
  let published = 0;
  let notified = 0;
  // Small transactions, so one large class never holds a long lock over the whole batch.
  for (const a of targets) {
    const cls = classes.find((c) => c.id === a.classId)!;
    await tenantTx(
      v.orgId,
      async (tx) => {
        const claim = await tx.assessment.updateMany({ where: { id: a.id, publishedAt: null }, data: { publishedAt: now, publishedById: v.membershipId } });
        if (claim.count !== 1) return;
        published++;
        await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.publish", entityType: "Assessment", entityId: a.id, meta: { classId: a.classId, mode: "PUBLISHER", via: "queue" } });
        notified += await notifyPublished(tx, v.orgId, a, cls, { effects, now, actorId: v.membershipId });
      },
      { timeout: 60_000 },
    );
  }
  const remaining = await v.db.assessment.count({ where: { classId: { in: classes.map((c) => c.id) }, readyAt: { not: null }, publishedAt: null } });
  return { ok: true, published, notified, remaining, effects };
}

/** A publisher takes a published assessment back. It returns to the queue as ready. Audited. */
export async function unpublishByPublisher(v: GradeViewer, assessmentId: string): Promise<Result> {
  if (!canPublish(v)) return { ok: false, error: "forbidden" };
  const a = await v.db.assessment.findUnique({ where: { id: assessmentId }, select: { id: true, classId: true, publishedAt: true, readyAt: true } });
  if (!a || !a.publishedAt) return { ok: false, error: "notFound" };
  await tenantTx(v.orgId, async (tx) => {
    await tx.assessment.update({ where: { id: a.id }, data: { publishedAt: null, publishedById: null, readyAt: a.readyAt ?? new Date() } });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.unpublish", entityType: "Assessment", entityId: a.id, meta: { classId: a.classId, via: "queue" } });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Report cards
// ---------------------------------------------------------------------------

const reportCardWhere = (visible: boolean): Prisma.DocumentWhereInput => ({ source: "GENERATED", visibleToFamily: visible, studentId: { not: null }, versions: { some: { storageKey: { startsWith: REPORT_KEY_PREFIX } } } });

/** Report cards waiting for release (made by staff, hidden from families), newest first. */
export async function reportCardQueue(v: GradeViewer, page = 1) {
  if (!canPublish(v)) return null;
  const where = reportCardWhere(false);
  const p = Math.max(1, Math.min(1000, page));
  const [rows, total] = await Promise.all([
    v.db.document.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p - 1) * QUEUE_PAGE, take: QUEUE_PAGE, select: { id: true, titleEn: true, titleAr: true, studentId: true, uploadedById: true, updatedAt: true, createdAt: true } }),
    v.db.document.count({ where }),
  ]);
  const students = rows.length ? await v.db.student.findMany({ where: { id: { in: rows.map((r) => r.studentId!) } }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true, studentNo: true } }) : [];
  return { total, page: p, pages: Math.max(1, Math.ceil(total / QUEUE_PAGE)), rows: rows.map((r) => ({ ...r, student: students.find((s) => s.id === r.studentId) ?? null })) };
}

/** Release report cards to families (ids, or all waiting, at most 200 per call). Each family is told once per version. */
export async function releaseReportCards(v: GradeViewer, input: { ids?: string[]; all?: boolean }, now = new Date()): Promise<Result<{ released: number; remaining: number; effects: Effect[] }>> {
  if (!canPublish(v)) return { ok: false, error: "forbidden" };
  if (!input.ids && !input.all) return { ok: false, error: "invalid" };
  const where: Prisma.DocumentWhereInput = { ...reportCardWhere(false), ...(input.ids ? { id: { in: input.ids.slice(0, MAX_BATCH) } } : {}) };
  const docs = await v.db.document.findMany({ where, take: MAX_BATCH, select: { id: true, studentId: true, currentVersionId: true, titleEn: true, titleAr: true } });
  const effects: Effect[] = [];
  let released = 0;
  for (const d of docs) {
    await tenantTx(v.orgId, async (tx) => {
      const claim = await tx.document.updateMany({ where: { id: d.id, visibleToFamily: false }, data: { visibleToFamily: true } });
      if (claim.count !== 1) return;
      released++;
      await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.report_card_release", entityType: "Document", entityId: d.id, meta: { studentId: d.studentId } });
      const s = await tx.student.findFirst({ where: { orgId: v.orgId, id: d.studentId! }, select: { id: true, firstNameEn: true, firstNameAr: true, membershipId: true, guardians: { where: { receivesUpdates: true }, select: { guardian: { select: { membershipId: true } } } } } });
      if (!s) return;
      const version = d.currentVersionId ? await tx.documentVersion.findUnique({ where: { id: d.currentVersionId }, select: { renderData: true } }) : null;
      const term = (version?.renderData as { term?: { en: string; ar: string } } | null)?.term ?? { en: "term", ar: "الفصل" };
      await tx.messageTemplate.upsert({
        where: { orgId_key_channel: { orgId: v.orgId, key: REPORT_RELEASE_TEMPLATE.key, channel: "EMAIL" } },
        create: { orgId: v.orgId, key: REPORT_RELEASE_TEMPLATE.key, channel: "EMAIL", subjectEn: REPORT_RELEASE_TEMPLATE.subjectEn, subjectAr: REPORT_RELEASE_TEMPLATE.subjectAr, bodyEn: REPORT_RELEASE_TEMPLATE.bodyEn, bodyAr: REPORT_RELEASE_TEMPLATE.bodyAr },
        update: {},
      });
      await notify(execCtx(tx, v.orgId, { now, effects, actorId: v.membershipId }), {
        recipients: [s.membershipId, ...s.guardians.map((g) => g.guardian.membershipId)].filter(Boolean) as string[],
        templateKey: REPORT_RELEASE_TEMPLATE.key,
        kind: "document_ready",
        vars: { student: { en: s.firstNameEn, ar: s.firstNameAr || s.firstNameEn }, term },
        href: "/documents",
        idempotencyBase: `reportcard:${d.id}:${d.currentVersionId ?? "v"}`,
      });
    });
  }
  const remaining = await v.db.document.count({ where: reportCardWhere(false) });
  return { ok: true, released, remaining, effects };
}

/** Hide a released report card from the family again. Audited. */
export async function withdrawReportCard(v: GradeViewer, documentId: string): Promise<Result> {
  if (!canPublish(v)) return { ok: false, error: "forbidden" };
  const d = await v.db.document.findFirst({ where: { id: documentId, ...reportCardWhere(true) }, select: { id: true, studentId: true } });
  if (!d) return { ok: false, error: "notFound" };
  await tenantTx(v.orgId, async (tx) => {
    await tx.document.update({ where: { id: d.id }, data: { visibleToFamily: false } });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: "grades.report_card_withdraw", entityType: "Document", entityId: d.id, meta: { studentId: d.studentId } });
  });
  return { ok: true };
}
