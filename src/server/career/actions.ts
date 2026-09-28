"use server";

import { revalidatePath } from "next/cache";
import type { ApplicationStatus, ShortlistCategory } from "@prisma/client";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { flushEffects } from "@/server/queue";
import { canSeeStudent } from "@/server/access/student-access";
import type { CareerWeights } from "./dimensions";
import { matchCareers, reasoning, scoreAssessment, suggestCategory } from "./scoring";

async function studentFor(ctx: Ctx, studentId?: string | null) {
  if (ctx.isStudent) return ctx.membership.student;
  if (studentId && (ctx.can("career.advise") || ctx.can("people.view")) && (await canSeeStudent(ctx, studentId))) {
    return ctx.db.student.findUnique({ where: { id: studentId } });
  }
  return null;
}

async function advisors(ctx: Ctx) {
  const rows = await ctx.db.membershipRole.findMany({ where: { orgId: ctx.orgId, role: { key: "career_advisor" } } });
  return rows.map((r) => r.membershipId);
}

export async function saveAnswersAction(answers: Record<string, number>) {
  const ctx = await getCtx();
  const student = ctx.membership.student;
  if (!student) return { ok: false };
  const open = await ctx.db.aptitudeAssessment.findFirst({ where: { studentId: student.id, completedAt: null } });
  if (open) await ctx.db.aptitudeAssessment.update({ where: { id: open.id }, data: { answers } });
  else await ctx.db.aptitudeAssessment.create({ data: { orgId: ctx.orgId, studentId: student.id, answers } });
  return { ok: true };
}

export async function completeAssessmentAction(answers: Record<string, number>) {
  const ctx = await getCtx();
  const student = ctx.membership.student;
  if (!student) return { ok: false as const };
  const { db, orgId } = ctx;
  const [questions, careers, enrollments] = await Promise.all([
    db.aptitudeQuestion.findMany({ where: { orgId } }),
    db.career.findMany({ where: { orgId } }),
    db.enrollment.findMany({ where: { studentId: student.id }, include: { class: { include: { subject: true } } } }),
  ]);
  const answered = questions.filter((q) => answers[q.id]).length;
  if (answered < questions.length) return { ok: false as const, error: "INCOMPLETE" };
  const scores = scoreAssessment(questions, answers);
  const subjects = enrollments.map((e) => e.class.subject?.code).filter(Boolean) as string[];
  const matches = matchCareers(scores, careers.map((c) => ({ id: c.id, key: c.key, weights: c.weights as CareerWeights, subjects: c.subjects })), subjects).slice(0, 8);
  const effects: Effect[] = [];
  await tenantTx(orgId, async (tx) => {
    const open = await tx.aptitudeAssessment.findFirst({ where: { studentId: student.id, completedAt: null } });
    const assessment = open
      ? await tx.aptitudeAssessment.update({ where: { id: open.id }, data: { answers, scores, completedAt: new Date() } })
      : await tx.aptitudeAssessment.create({ data: { orgId, studentId: student.id, answers, scores, completedAt: new Date() } });
    await tx.careerRecommendation.deleteMany({ where: { studentId: student.id, status: "DRAFT" } });
    for (const [i, m] of matches.entries()) {
      const career = careers.find((c) => c.id === m.careerId)!;
      const r = reasoning(m, { en: career.titleEn, ar: career.titleAr });
      await tx.careerRecommendation.create({
        data: { orgId, studentId: student.id, assessmentId: assessment.id, careerId: career.id, rank: i + 1, matchScore: m.matchScore, reasoningEn: r.en, reasoningAr: r.ar, status: "DRAFT" },
      });
    }
    await tx.careerProfile.upsert({ where: { studentId: student.id }, create: { orgId, studentId: student.id, interestsEn: [], interestsAr: [], favoriteSubjects: subjects, preferredCountries: [] }, update: { favoriteSubjects: subjects } });
    await tx.timelineEvent.create({ data: { orgId, studentId: student.id, actorId: ctx.membershipId, kind: "status", titleEn: "Career aptitude assessment completed", titleAr: "أكمل الطالب اختبار الميول المهنية" } });
    // Close the "take the assessment" task if there is one.
    await tx.task.updateMany({ where: { assigneeId: ctx.membershipId, href: "/career/assessment", status: { not: "DONE" } }, data: { status: "DONE", completedAt: new Date() } });
    await notify(execCtx(tx, orgId, { effects }), {
      recipients: await advisors(ctx),
      templateKey: "case_assigned",
      vars: { title: { en: `Career results to review: ${student.firstNameEn} ${student.lastNameEn}`, ar: `نتائج مهنية للمراجعة: ${student.firstNameAr} ${student.lastNameAr}` }, student: { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` } },
      href: `/career/students/${student.id}`,
      channels: ["IN_APP"],
      idempotencyBase: `assessment:${assessment.id}`,
    });
  });
  await flushEffects(effects);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function chooseCareerAction(careerId: string) {
  const ctx = await getCtx();
  const student = ctx.membership.student;
  if (!student) return { ok: false };
  const career = await ctx.db.career.findUnique({ where: { id: careerId } });
  if (!career) return { ok: false };
  const effects: Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.careerProfile.upsert({ where: { studentId: student.id }, create: { orgId: ctx.orgId, studentId: student.id, interestsEn: [], interestsAr: [], favoriteSubjects: [], preferredCountries: [], chosenCareerId: career.id }, update: { chosenCareerId: career.id } });
    await tx.careerRecommendation.updateMany({ where: { studentId: student.id }, data: { chosen: false } });
    await tx.careerRecommendation.updateMany({ where: { studentId: student.id, careerId: career.id }, data: { chosen: true } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, studentId: student.id, actorId: ctx.membershipId, kind: "status", titleEn: `Chose a career path: ${career.titleEn}`, titleAr: `اختار مسارًا مهنيًا: ${career.titleAr}` } });
    const careerCase = await tx.case.findFirst({ where: { studentId: student.id, type: "CAREER", status: { notIn: ["CLOSED", "RESOLVED"] } } });
    if (careerCase) {
      await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: careerCase.id, studentId: student.id, actorId: ctx.membershipId, kind: "status", titleEn: `Student chose ${career.titleEn}`, titleAr: `اختار الطالب مهنة ${career.titleAr}`, staffOnly: true } });
    }
    await notify(execCtx(tx, ctx.orgId, { effects }), {
      recipients: await advisors(ctx),
      templateKey: "case_assigned",
      vars: { title: { en: `${student.firstNameEn} chose ${career.titleEn}`, ar: `اختار ${student.firstNameAr} مهنة ${career.titleAr}` }, student: { en: student.firstNameEn, ar: student.firstNameAr } },
      href: `/career/students/${student.id}`,
      channels: ["IN_APP"],
      idempotencyBase: `choose:${student.id}:${career.id}:${Date.now()}`,
    });
  });
  await flushEffects(effects);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reviewRecommendationsAction(input: { studentId: string; approve: string[]; reject: string[] }) {
  const ctx = await getCtx();
  if (!ctx.can("career.advise")) return { ok: false };
  const student = await studentFor(ctx, input.studentId);
  if (!student) return { ok: false };
  const effects: Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    const now = new Date();
    if (input.approve.length) await tx.careerRecommendation.updateMany({ where: { id: { in: input.approve }, studentId: student.id }, data: { status: "APPROVED", approvedById: ctx.membershipId, approvedAt: now } });
    if (input.reject.length) await tx.careerRecommendation.updateMany({ where: { id: { in: input.reject }, studentId: student.id }, data: { status: "REJECTED", approvedById: ctx.membershipId, approvedAt: now } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, studentId: student.id, actorId: ctx.membershipId, kind: "approved", titleEn: "Career recommendations reviewed by the advisor", titleAr: "راجعت المستشارة التوصيات المهنية" } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "career.recommendations.review", entityType: "Student", entityId: student.id, meta: { approved: input.approve.length, rejected: input.reject.length } as never } });
    if (student.membershipId) {
      await notify(execCtx(tx, ctx.orgId, { effects }), {
        recipients: [student.membershipId],
        templateKey: "request_completed",
        vars: { number: "", title: { en: "Your career matches were reviewed by your advisor", ar: "راجعت مستشارتك نتائجك المهنية" } },
        href: "/career",
        channels: ["IN_APP"],
        idempotencyBase: `recs:${student.id}:${now.getTime()}`,
      });
    }
  });
  await flushEffects(effects);
  revalidatePath("/", "layout");
  return { ok: true };
}

const DEFAULT_REQUIREMENTS: Array<{ en: string; ar: string; weeksBefore: number }> = [
  { en: "Personal statement drafted", ar: "إعداد المقال الشخصي", weeksBefore: 8 },
  { en: "Predicted grades requested", ar: "طلب الدرجات المتوقعة", weeksBefore: 6 },
  { en: "Reference letter requested", ar: "طلب خطاب التوصية", weeksBefore: 6 },
  { en: "English test (IELTS or TOEFL) booked", ar: "حجز اختبار اللغة الإنجليزية (IELTS أو TOEFL)", weeksBefore: 10 },
  { en: "Application form submitted", ar: "تقديم طلب الالتحاق", weeksBefore: 0 },
];

function nextDeadline(month: number | null) {
  if (!month) return null;
  const now = new Date();
  const year = now.getUTCMonth() + 1 > month ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return new Date(Date.UTC(year, month - 1, 15, 8));
}

export async function addShortlistAction(input: { studentId?: string | null; universityId: string; programEn: string; category?: ShortlistCategory }) {
  const ctx = await getCtx();
  const student = await studentFor(ctx, input.studentId);
  if (!student) return { ok: false };
  const uni = await ctx.db.university.findUnique({ where: { id: input.universityId } });
  if (!uni) return { ok: false };
  const exists = await ctx.db.shortlistEntry.findFirst({ where: { studentId: student.id, universityId: uni.id } });
  if (exists) return { ok: true };
  const deadline = nextDeadline(uni.deadlineMonth);
  await ctx.db.shortlistEntry.create({
    data: {
      orgId: ctx.orgId,
      studentId: student.id,
      universityId: uni.id,
      programEn: input.programEn || uni.programsEn[0] || "",
      category: input.category ?? suggestCategory(uni.acceptanceRate),
      status: "RESEARCHING",
      deadline,
      requirements: {
        create: DEFAULT_REQUIREMENTS.map((r) => ({ orgId: ctx.orgId, labelEn: r.en, labelAr: r.ar, dueAt: deadline ? new Date(deadline.getTime() - r.weeksBefore * 7 * 86400_000) : null })),
      },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateShortlistAction(input: { entryId: string; status?: ApplicationStatus; category?: ShortlistCategory; remove?: boolean }) {
  const ctx = await getCtx();
  const entry = await ctx.db.shortlistEntry.findUnique({ where: { id: input.entryId } });
  if (!entry || !(await studentFor(ctx, entry.studentId))) return { ok: false };
  if (input.remove) await ctx.db.shortlistEntry.delete({ where: { id: entry.id } });
  else await ctx.db.shortlistEntry.update({ where: { id: entry.id }, data: { status: input.status, category: input.category } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function toggleRequirementAction(input: { requirementId: string; done: boolean }) {
  const ctx = await getCtx();
  const req = await ctx.db.shortlistRequirement.findUnique({ where: { id: input.requirementId }, include: { entry: true } });
  if (!req || !(await studentFor(ctx, req.entry.studentId))) return { ok: false };
  await ctx.db.shortlistRequirement.update({ where: { id: req.id }, data: { done: input.done } });
  revalidatePath("/", "layout");
  return { ok: true };
}
