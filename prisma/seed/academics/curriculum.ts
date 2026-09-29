// Demo data for the curriculum module: three frameworks, a term of lesson plans for Daniel Carter's Grade 9
// Computing class in every status (two waiting for the Head of Computing), one AI-drafted unit, and a few
// plans in Mathematics and Science so coverage is never empty. Safe to re-run: frameworks and standards are
// upserted by key and code; plans use stable ids and are only created once.
import type { Prisma, PrismaClient } from "@prisma/client";
import { execCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { ensurePlanTemplates } from "@/server/curriculum/review";
import { draftLesson, draftUnitFallback, type DraftInputStandard } from "@/server/curriculum/drafter";
import { writeBilingualText } from "@/server/curriculum/types";
import { termOf } from "@/server/curriculum/coverage";
import type { SeedWorld } from "../demo";
import { stableId } from "../lib";
import { AI_UNIT_CODES, COMPUTING_PLANS, FRAMEWORKS, MATHS_PLANS, SCIENCE_PLANS, type SeedPlan } from "./curriculum-data";

const DAY = 86_400_000;

export async function seedCurriculum(w: SeedWorld) {
  await seedCurriculumFor(w.db, w.orgId, w.now);
  w.log("curriculum: frameworks and lesson plans");
}

type Std = DraftInputStandard;

export async function seedCurriculumFor(db: PrismaClient, orgId: string, now: Date) {
  const tx = db as unknown as Prisma.TransactionClient;
  await ensurePlanTemplates(tx, orgId);

  const subjects = await db.subject.findMany({ where: { orgId } });
  const personas = await db.demoPersona.findMany({ where: { orgId } });
  const persona = (key: string) => personas.find((p) => p.key === key)?.membershipId ?? null;
  const daniel = persona("teacher");
  const anand = persona("hod_computing");
  const principal = persona("principal");

  // Frameworks and standards
  const byCode = new Map<string, Std>();
  const frameworkIds = new Map<string, string>();
  for (const f of FRAMEWORKS) {
    const subject = subjects.find((s) => s.code === f.subjectCode);
    if (!subject) continue;
    const fw = await db.curriculumFramework.upsert({
      where: { orgId_key: { orgId, key: f.key } },
      create: { orgId, key: f.key, nameEn: f.name[0], nameAr: f.name[1], sourceEn: f.source, subjectId: subject.id, gradeLevel: f.grade, createdById: persona("admin"), createdAt: new Date(now.getTime() - 120 * DAY) },
      update: { nameEn: f.name[0], nameAr: f.name[1], sourceEn: f.source, subjectId: subject.id, gradeLevel: f.grade },
    });
    frameworkIds.set(f.key, fw.id);
    for (const [i, s] of f.standards.entries()) {
      const data = { strandEn: s.strand[0], strandAr: s.strand[1], descEn: s.desc[0], descAr: s.desc[1], sortOrder: i + 1 };
      const row = await db.curriculumStandard.upsert({ where: { frameworkId_code: { frameworkId: fw.id, code: s.code } }, create: { orgId, frameworkId: fw.id, code: s.code, ...data }, update: data });
      byCode.set(s.code, { id: row.id, code: s.code, strandEn: data.strandEn, strandAr: data.strandAr, descEn: data.descEn, descAr: data.descAr });
    }
  }

  // Terms and the current week of term
  const year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, include: { terms: { orderBy: { startsOn: "asc" } } } });
  const terms = year?.terms ?? [];
  const term = terms.find((t) => now >= t.startsOn && now <= t.endsOn) ?? terms.find((t) => t.startsOn > now) ?? terms[terms.length - 1];
  const termStart = term ? term.startsOn : new Date(now.getTime() - 35 * DAY);
  const monday = new Date(termStart.getTime() + ((8 - (termStart.getUTCDay() || 7)) % 7) * DAY);
  const currentWeek = Math.max(1, Math.floor((now.getTime() - monday.getTime()) / (7 * DAY)) + 1);
  const dateFor = (week: number, lessonInWeek: number) => new Date(monday.getTime() + ((week - 1) * 7 + (lessonInWeek === 0 ? 0 : 2)) * DAY + 8 * 3600_000);

  const classes = await db.schoolClass.findMany({ where: { orgId, isHomeroom: false, ...(year ? { academicYearId: year.id } : {}) } });
  const classFor = (code: string, grade: number) => {
    const subject = subjects.find((s) => s.code === code);
    return classes.find((c) => c.subjectId === subject?.id && c.gradeLevel === grade) ?? null;
  };
  const people = await db.membership.findMany({ where: { orgId, id: { in: [daniel, anand, principal].filter(Boolean) as string[] } }, include: { user: true } });
  const nameOf = (id: string | null) => {
    const u = people.find((p) => p.id === id)?.user;
    return { en: u?.nameEn ?? "", ar: u?.nameAr || u?.nameEn || "" };
  };

  type Placement = { plan: SeedPlan; week: number; slot: number };
  async function createPlans(opts: { list: Placement[]; subjectCode: string; grade: number; authorId: string; reviewerId: string | null; aiDrafted?: boolean; notifyReviewer?: boolean }) {
    const subject = subjects.find((s) => s.code === opts.subjectCode);
    if (!subject) return 0;
    const cls = classFor(opts.subjectCode, opts.grade);
    let created = 0;
    for (const { plan, week, slot } of opts.list) {
      const id = stableId("lesson-plan", orgId, plan.key);
      if (await db.lessonPlan.findUnique({ where: { id } })) continue;
      const standards = plan.codes.map((c) => byCode.get(c)).filter((s): s is Std => Boolean(s));
      if (!standards.length) continue;
      const lesson = draftLesson(standards, { subjectCode: subject.code, subjectEn: subject.nameEn, subjectAr: subject.nameAr, gradeLevel: opts.grade, durationMin: 50 }, { titleEn: plan.title[0], titleAr: plan.title[1] });
      const plannedFor = dateFor(week, slot);
      const createdAt = new Date(Math.min(plannedFor.getTime() - (plan.status === "DRAFT" ? 2 : 12) * DAY, now.getTime() - (created + 1) * 5 * 3600_000));
      const submittedAt = new Date(createdAt.getTime() + 2 * DAY + 3 * 3600_000);
      const reviewedAt = plan.status === "APPROVED" || plan.status === "CHANGES_REQUESTED" ? new Date(Math.min(submittedAt.getTime() + 1 * DAY + 5 * 3600_000, now.getTime() - 3600_000)) : null;
      await db.lessonPlan.create({
        data: {
          id,
          orgId,
          subjectId: subject.id,
          gradeLevel: opts.grade,
          classId: cls?.id ?? null,
          termId: termOf({ termId: null, plannedFor }, terms),
          weekNo: week,
          plannedFor,
          titleEn: lesson.titleEn,
          titleAr: lesson.titleAr,
          objectivesEn: lesson.objectivesEn,
          objectivesAr: lesson.objectivesAr,
          activities: lesson.activities as never,
          materials: lesson.materials as never,
          assessmentEn: lesson.assessmentEn,
          assessmentAr: lesson.assessmentAr,
          differentiation: writeBilingualText(lesson.differentiation),
          durationMin: lesson.durationMin,
          status: plan.status,
          authorId: opts.authorId,
          reviewerId: reviewedAt ? opts.reviewerId : null,
          reviewComment: reviewedAt ? (plan.comment ?? null) : null,
          reviewedAt,
          aiDrafted: Boolean(opts.aiDrafted),
          createdAt,
          updatedAt: reviewedAt ?? (plan.status === "SUBMITTED" ? submittedAt : createdAt),
          standards: { create: standards.map((s) => ({ orgId, standardId: s.id })) },
        },
      });
      const events: Prisma.AuditEventCreateManyInput[] = [{ orgId, actorId: opts.authorId, action: "lesson_plan.create", entityType: "LessonPlan", entityId: id, createdAt, meta: opts.aiDrafted ? { aiDrafted: true } : undefined }];
      if (plan.status !== "DRAFT") events.push({ orgId, actorId: opts.authorId, action: "lesson_plan.submit", entityType: "LessonPlan", entityId: id, createdAt: submittedAt, meta: { from: "DRAFT" } });
      if (reviewedAt && opts.reviewerId) events.push({ orgId, actorId: opts.reviewerId, action: plan.status === "APPROVED" ? "lesson_plan.approve" : "lesson_plan.request_changes", entityType: "LessonPlan", entityId: id, reason: plan.comment ?? null, createdAt: reviewedAt });
      await db.auditEvent.createMany({ data: events });

      const title = { en: lesson.titleEn, ar: lesson.titleAr };
      if (plan.status === "SUBMITTED" && opts.reviewerId && opts.notifyReviewer) {
        await notify(execCtx(tx, orgId, { now: submittedAt, quiet: true }), { recipients: [opts.reviewerId], templateKey: "lesson_plan_submitted", vars: { title, teacher: nameOf(opts.authorId) }, href: `/curriculum/plans/${id}`, idempotencyBase: `lesson-plan:${id}:submitted:1` });
      }
      if (plan.status === "CHANGES_REQUESTED" && opts.reviewerId && reviewedAt) {
        await notify(execCtx(tx, orgId, { now: reviewedAt, quiet: true }), { recipients: [opts.authorId], templateKey: "lesson_plan_changes", vars: { title, reviewer: nameOf(opts.reviewerId), comment: plan.comment ?? "" }, href: `/curriculum/plans/${id}`, idempotencyBase: `lesson-plan:${id}:CHANGES_REQUESTED:${reviewedAt.getTime()}` });
      }
      created++;
    }
    return created;
  }

  // A plan sequence laid out two lessons a week, ending around the current week.
  const firstWeek = (list: SeedPlan[]) => {
    const pastWeeks = Math.ceil(list.filter((p) => p.status === "APPROVED" || p.status === "CHANGES_REQUESTED").length / 2);
    return Math.max(1, currentWeek - pastWeeks);
  };
  const place = (list: SeedPlan[], start: number): Placement[] => list.map((plan, i) => ({ plan, week: start + Math.floor(i / 2), slot: i % 2 }));

  let total = 0;
  if (daniel) {
    const start = firstWeek(COMPUTING_PLANS);
    const placed = place(COMPUTING_PLANS, start);
    total += await createPlans({ list: placed, subjectCode: "CS", grade: 9, authorId: daniel, reviewerId: anand, notifyReviewer: true });

    // One AI-drafted unit on digital citizenship, saved as drafts the teacher is still editing.
    const cs = subjects.find((s) => s.code === "CS");
    const unitStandards = AI_UNIT_CODES.map((c) => byCode.get(c)).filter((s): s is Std => Boolean(s));
    if (cs && unitStandards.length && !(await db.lessonPlan.findUnique({ where: { id: stableId("lesson-plan", orgId, "ai-unit-0") } }))) {
      const unit = draftUnitFallback(unitStandards, { subjectCode: cs.code, subjectEn: cs.nameEn, subjectAr: cs.nameAr, gradeLevel: 9, durationMin: 50 });
      const lastWeek = placed[placed.length - 1]?.week ?? currentWeek;
      const unitPlans: Placement[] = unit.map((l, i) => ({
        plan: { key: `ai-unit-${i}`, codes: unitStandards.filter((s) => l.standardIds.includes(s.id)).map((s) => s.code), title: [l.titleEn, l.titleAr], status: "DRAFT" },
        week: lastWeek + 1 + i,
        slot: 0,
      }));
      await db.aiInteraction.create({
        data: { orgId, membershipId: daniel, feature: "lesson_plan", locale: "en", status: "ACCEPTED", provider: "built-in", subjectType: "CurriculumFramework", subjectId: frameworkIds.get("cs-g9") ?? null, output: { lessons: unit } as never, reviewedById: daniel, reviewedAt: new Date(now.getTime() - 1 * DAY), createdAt: new Date(now.getTime() - 1 * DAY - 600_000) },
      });
      total += await createPlans({ list: unitPlans, subjectCode: "CS", grade: 9, authorId: daniel, reviewerId: anand, aiDrafted: true });
    }
  }

  const maths = classFor("MATH", 9);
  if (maths?.teacherMembershipId) {
    const head = (await db.subject.findFirst({ where: { orgId, code: "MATH" }, include: { department: true } }))?.department?.headMembershipId ?? principal;
    total += await createPlans({ list: place(MATHS_PLANS, firstWeek(MATHS_PLANS)), subjectCode: "MATH", grade: 9, authorId: maths.teacherMembershipId, reviewerId: head !== maths.teacherMembershipId ? head : principal, notifyReviewer: true });
  }
  const physics = classFor("PHYS", 10);
  if (physics?.teacherMembershipId) {
    const head = (await db.subject.findFirst({ where: { orgId, code: "PHYS" }, include: { department: true } }))?.department?.headMembershipId ?? principal;
    total += await createPlans({ list: place(SCIENCE_PLANS, firstWeek(SCIENCE_PLANS)), subjectCode: "PHYS", grade: 10, authorId: physics.teacherMembershipId, reviewerId: head !== physics.teacherMembershipId ? head : principal });
  }
  return { frameworks: frameworkIds.size, standards: byCode.size, plans: total };
}
