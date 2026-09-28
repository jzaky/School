"use server";

import { revalidatePath } from "next/cache";
import { getCtx, type Ctx } from "@/server/context";
import { canViewCase, SENSITIVE } from "@/server/access/case-access";
import { schoolKpis } from "@/server/analytics/kpis";
import { generateAi, reviewAi } from "./provider";

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export type CaseBrief = { summary: string; keyPoints: string[]; questions: string[]; watchFor: string[] };
const isBrief = (v: unknown): v is CaseBrief => {
  const o = v as CaseBrief;
  return Boolean(o) && typeof o.summary === "string" && isStrArr(o.keyPoints) && isStrArr(o.questions) && isStrArr(o.watchFor);
};

async function caseFacts(ctx: Ctx, caseId: string) {
  const { db } = ctx;
  const c = await db.case.findUnique({ where: { id: caseId }, include: { student: true, notes: { include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { occurredAt: "desc" }, take: 8 } } });
  if (!c) return null;
  const since = new Date(Date.now() - 30 * 86400_000);
  const [attendance, enrollments, profile, assessment, recs, shortlist, tasks, nextMeeting] = await Promise.all([
    db.attendanceRecord.groupBy({ by: ["status"], where: { studentId: c.studentId, date: { gte: since } }, _count: { _all: true } }),
    db.enrollment.findMany({ where: { studentId: c.studentId, class: { isHomeroom: false } }, include: { class: { include: { subject: true } } } }),
    db.careerProfile.findUnique({ where: { studentId: c.studentId } }),
    db.aptitudeAssessment.findFirst({ where: { studentId: c.studentId, completedAt: { not: null } }, orderBy: { completedAt: "desc" } }),
    db.careerRecommendation.findMany({ where: { studentId: c.studentId }, include: { career: true }, orderBy: { rank: "asc" }, take: 5 }),
    db.shortlistEntry.findMany({ where: { studentId: c.studentId }, include: { university: true } }),
    db.task.findMany({ where: { caseId, status: { in: ["TODO", "IN_PROGRESS"] } } }),
    db.appointment.findFirst({ where: { caseId, startsAt: { gte: new Date() }, status: "CONFIRMED" }, include: { type: true }, orderBy: { startsAt: "asc" } }),
  ]);
  const total = attendance.reduce((s, a) => s + a._count._all, 0);
  const present = attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").reduce((s, a) => s + a._count._all, 0);
  const chosen = profile?.chosenCareerId ? recs.find((r) => r.careerId === profile.chosenCareerId)?.career : null;
  const scores = (assessment?.scores ?? null) as Record<string, number> | null;
  const topDims = scores ? Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k) : [];
  return {
    c,
    facts: {
      student: { firstName: ctx.locale === "ar" ? c.student.firstNameAr : c.student.firstNameEn, grade: c.student.gradeLevel },
      case: { type: c.type, title: ctx.locale === "ar" ? c.titleAr : c.titleEn, summary: c.summaryEn, priority: c.priority, status: c.status, openedDaysAgo: Math.round((Date.now() - c.openedAt.getTime()) / 86400_000) },
      attendance30Days: total ? Math.round((present / total) * 100) : null,
      subjects: enrollments.map((e) => e.class.subject?.nameEn).filter(Boolean),
      recentNotes: c.notes.map((n) => n.versions[0]?.body).filter(Boolean),
      openTasks: tasks.map((t) => t.titleEn),
      nextMeeting: nextMeeting ? { type: nextMeeting.type.nameEn, at: nextMeeting.startsAt.toISOString() } : null,
      career: c.type === "CAREER" || profile ? { interests: profile?.interestsEn ?? [], topStrengths: topDims, recommendations: recs.map((r) => ({ career: r.career.titleEn, match: r.matchScore, status: r.status })), chosenCareer: chosen?.titleEn ?? null, shortlist: shortlist.map((s) => ({ university: s.university.nameEn, category: s.category, status: s.status })) } : null,
    },
    extra: { chosen, topDims, recs, enrollments, attendancePct: total ? Math.round((present / total) * 100) : 100 },
  };
}

function briefFallback(ctx: Ctx, data: NonNullable<Awaited<ReturnType<typeof caseFacts>>>): CaseBrief {
  const ar = ctx.locale === "ar";
  const { c, extra } = data;
  const name = ar ? c.student.firstNameAr : c.student.firstNameEn;
  const notes = c.notes.slice(0, 3).map((n) => n.versions[0]?.body).filter(Boolean) as string[];
  if (c.type === "CAREER") {
    const top = extra.recs.slice(0, 3).map((r) => (ar ? r.career.titleAr : r.career.titleEn));
    const chosen = extra.chosen ? (ar ? extra.chosen.titleAr : extra.chosen.titleEn) : null;
    return ar
      ? {
          summary: `يطلب ${name} (الصف ${c.student.gradeLevel}) جلسة توجيه مهني. ${chosen ? `اختار مسار ${chosen} بعد إكمال اختبار الميول.` : top.length ? `أبرز المهن المقترحة من الاختبار: ${top.join("، ")}.` : "لم يُكمل اختبار الميول بعد."} نسبة حضوره خلال آخر 30 يومًا ${extra.attendancePct}%.`,
          keyPoints: [
            ...(top.length ? [`أعلى نسب التوافق: ${extra.recs.slice(0, 3).map((r) => `${r.career.titleAr} ${r.matchScore}%`).join("، ")}`] : []),
            `المواد الحالية: ${extra.enrollments.map((e) => e.class.subject?.nameAr).filter(Boolean).join("، ")}`,
            ...(chosen ? [`المسار المختار: ${chosen}، ويحتاج إلى التحقق من متطلبات المواد الدراسية`] : []),
          ],
          questions: [
            "ما الذي جذبك إلى هذا المجال؟ حدثني عن مشروع أو نشاط استمتعت به.",
            "أي المواد تشعر أنك تتقدم فيها أكثر، وأيها تحتاج فيها إلى دعم؟",
            "هل تفضّل الدراسة داخل الإمارات أم خارجها؟ ولماذا؟",
            "ما الذي تحتاج أن يعرفه والداك عن خطتك؟",
          ],
          watchFor: ["توافق المواد الحالية مع متطلبات القبول الجامعي", "مواعيد التقديم الجامعي القادمة"],
        }
      : {
          summary: `${name} (Grade ${c.student.gradeLevel}) asked for career guidance. ${chosen ? `After the aptitude assessment they chose ${chosen}.` : top.length ? `Top matches from the assessment: ${top.join(", ")}.` : "The aptitude assessment is not complete yet."} Attendance over the last 30 days is ${extra.attendancePct}%.`,
          keyPoints: [
            ...(top.length ? [`Strongest matches: ${extra.recs.slice(0, 3).map((r) => `${r.career.titleEn} ${r.matchScore}%`).join(", ")}`] : []),
            `Current subjects: ${extra.enrollments.map((e) => e.class.subject?.nameEn).filter(Boolean).join(", ")}`,
            ...(chosen ? [`Chosen path: ${chosen}. Check subject requirements against the current timetable.`] : []),
          ],
          questions: [
            "What drew you to this field? Tell me about a project or activity you enjoyed.",
            "Which subjects feel strongest right now, and where would support help?",
            "Would you like to study in the UAE or abroad, and why?",
            "What do your parents need to know about your plan?",
          ],
          watchFor: ["Whether current subjects match university entry requirements", "Upcoming application deadlines"],
        };
  }
  return ar
    ? {
        summary: `حالة ${c.type === "ACADEMIC" ? "أكاديمية" : "دعم"} تخص ${name} (الصف ${c.student.gradeLevel})، مفتوحة منذ ${Math.round((Date.now() - c.openedAt.getTime()) / 86400_000)} يومًا. نسبة الحضور خلال 30 يومًا ${extra.attendancePct}%.`,
        keyPoints: notes.length ? notes.map((n) => n.slice(0, 160)) : ["لا توجد ملاحظات مسجلة بعد"],
        questions: ["كيف تسير الأمور معك في المدرسة هذه الأيام؟", "ما الذي يجعل هذه المادة صعبة الآن؟", "ما الذي ساعدك سابقًا عندما واجهت صعوبة؟", "من تحب أن يدعمك في المدرسة وفي البيت؟"],
        watchFor: ["التغيرات في الحضور والواجبات", "مدى تواصل الأسرة ومشاركتها"],
      }
    : {
        summary: `${c.type === "ACADEMIC" ? "Academic support" : "Support"} case for ${name} (Grade ${c.student.gradeLevel}), open for ${Math.round((Date.now() - c.openedAt.getTime()) / 86400_000)} days. Attendance over the last 30 days is ${extra.attendancePct}%.`,
        keyPoints: notes.length ? notes.map((n) => n.slice(0, 160)) : ["No notes recorded yet"],
        questions: ["How are things going at school at the moment?", "What makes this subject feel hard right now?", "What has helped before when something was difficult?", "Who would you like support from, at school and at home?"],
        watchFor: ["Changes in attendance and homework completion", "How engaged the family is"],
      };
}

export async function caseBriefAction(caseId: string) {
  const ctx = await getCtx();
  const data = await caseFacts(ctx, caseId);
  if (!data || !(await canViewCase(ctx, data.c, { audit: false }))) return { status: "error" as const };
  const sensitive = SENSITIVE.includes(data.c.sensitivity) || data.c.sensitivity === "MEDICAL";
  return generateAi<CaseBrief>(ctx, {
    feature: "case_brief",
    sensitive,
    subjectType: "Case",
    subjectId: caseId,
    instructions: "Prepare a pre-meeting brief for the staff member who owns this case: a short summary, key points, four open questions to ask the student, and things to watch for.",
    outputShape: '{"summary": string, "keyPoints": string[], "questions": string[], "watchFor": string[]}',
    facts: data.facts,
    fallback: () => briefFallback(ctx, data),
    validate: isBrief,
  });
}

// ---------------------------------------------------------------------------
// Action plans
// ---------------------------------------------------------------------------

export type PlanDraft = { title: string; items: Array<{ text: string; owner: "student" | "staff" | "parent"; dueInDays: number }> };
const isPlan = (v: unknown): v is PlanDraft => {
  const o = v as PlanDraft;
  return Boolean(o) && typeof o.title === "string" && Array.isArray(o.items) && o.items.every((i) => typeof i.text === "string" && ["student", "staff", "parent"].includes(i.owner) && typeof i.dueInDays === "number");
};

function planFallback(ctx: Ctx, data: NonNullable<Awaited<ReturnType<typeof caseFacts>>>): PlanDraft {
  const ar = ctx.locale === "ar";
  const { c, extra } = data;
  if (c.type === "CAREER") {
    const career = extra.chosen ? (ar ? extra.chosen.titleAr : extra.chosen.titleEn) : ar ? "المسار المختار" : "the chosen path";
    const tech = extra.chosen && ["ai_engineer", "software_developer", "data_scientist", "cybersecurity_analyst", "robotics_engineer"].includes(extra.chosen.key);
    return ar
      ? {
          title: `خطة العمل نحو ${career}`,
          items: [
            ...(tech ? [{ text: "التقدم بطلب لتغيير مادة الفيزياء إلى علوم الحاسوب للفصل القادم", owner: "student" as const, dueInDays: 7 }] : []),
            { text: tech ? "الانضمام إلى نادي الروبوتات أو البرمجة في المدرسة" : "الانضمام إلى نادٍ أو نشاط مرتبط بالمجال", owner: "student", dueInDays: 14 },
            { text: tech ? "إكمال دورة مجانية في أساسيات بايثون وتسجيل التقدم" : "إكمال دورة قصيرة عبر الإنترنت في المجال", owner: "student", dueInDays: 30 },
            { text: "البحث في ثلاث جامعات (داخل الإمارات وخارجها) وإضافتها إلى القائمة المختصرة", owner: "student", dueInDays: 21 },
            { text: "مراجعة متطلبات القبول وتحديث قائمة المتطلبات", owner: "staff", dueInDays: 14 },
            { text: "مناقشة الخطة في البيت ومشاركة أي أسئلة مع المستشارة", owner: "parent", dueInDays: 10 },
          ],
        }
      : {
          title: `Action plan towards ${career}`,
          items: [
            ...(tech ? [{ text: "Request a subject change from Physics to Computer Science for next term", owner: "student" as const, dueInDays: 7 }] : []),
            { text: tech ? "Join the robotics or coding club" : "Join a club or activity linked to the field", owner: "student", dueInDays: 14 },
            { text: tech ? "Complete a free introductory Python course and log progress" : "Complete a short online course in the field", owner: "student", dueInDays: 30 },
            { text: "Research three universities (UAE and abroad) and add them to the shortlist", owner: "student", dueInDays: 21 },
            { text: "Check entry requirements and update the requirements checklist", owner: "staff", dueInDays: 14 },
            { text: "Talk the plan through at home and share any questions with the advisor", owner: "parent", dueInDays: 10 },
          ],
        };
  }
  return ar
    ? {
        title: "خطة الدعم الأكاديمي",
        items: [
          { text: "حضور حصص الدعم في وقت الغداء مرتين أسبوعيًا", owner: "student", dueInDays: 7 },
          { text: "استخدام مخطط أسبوعي للواجبات ومراجعته مع معلم الفصل كل يوم جمعة", owner: "student", dueInDays: 7 },
          { text: "مشاركة ملاحظات قصيرة عن التقدم مع المرشدة كل أسبوعين", owner: "staff", dueInDays: 14 },
          { text: "متابعة المخطط الأسبوعي في البيت وتشجيع روتين دراسي هادئ", owner: "parent", dueInDays: 7 },
          { text: "مراجعة التقدم في اجتماع متابعة", owner: "staff", dueInDays: 21 },
        ],
      }
    : {
        title: "Academic support plan",
        items: [
          { text: "Attend lunchtime support sessions twice a week", owner: "student", dueInDays: 7 },
          { text: "Use a weekly homework planner and check it with the homeroom tutor every Friday", owner: "student", dueInDays: 7 },
          { text: "Share short progress notes with the counselor every two weeks", owner: "staff", dueInDays: 14 },
          { text: "Check the planner at home and encourage a calm study routine", owner: "parent", dueInDays: 7 },
          { text: "Review progress at a follow-up meeting", owner: "staff", dueInDays: 21 },
        ],
      };
}

export async function draftActionPlanAction(caseId: string) {
  const ctx = await getCtx();
  const data = await caseFacts(ctx, caseId);
  if (!data || !(await canViewCase(ctx, data.c, { audit: false }))) return { status: "error" as const };
  const sensitive = SENSITIVE.includes(data.c.sensitivity) || data.c.sensitivity === "MEDICAL";
  const res = await generateAi<PlanDraft>(ctx, {
    feature: "action_plan",
    sensitive,
    subjectType: "Case",
    subjectId: caseId,
    instructions: "Draft a practical action plan of 4 to 6 steps for this student. Each step has an owner (student, staff or parent) and a due date in days from today.",
    outputShape: '{"title": string, "items": [{"text": string, "owner": "student"|"staff"|"parent", "dueInDays": number}]}',
    facts: data.facts,
    fallback: () => planFallback(ctx, data),
    validate: isPlan,
  });
  if (res.status !== "ok") return res;
  const plan = await ctx.db.actionPlan.create({
    data: {
      orgId: ctx.orgId,
      caseId,
      studentId: data.c.studentId,
      titleEn: res.output.title,
      titleAr: res.output.title,
      status: "DRAFT",
      fromAi: true,
      createdById: ctx.membershipId,
      items: {
        create: res.output.items.map((it, i) => ({
          orgId: ctx.orgId,
          textEn: it.text,
          textAr: it.text,
          ownerRole: it.owner,
          dueAt: new Date(Date.now() + Math.max(1, it.dueInDays) * 86400_000),
          order: i,
        })),
      },
    },
  });
  await ctx.db.timelineEvent.create({ data: { orgId: ctx.orgId, caseId, studentId: data.c.studentId, actorId: ctx.membershipId, kind: "ai_brief", titleEn: "Action plan drafted with AI, awaiting review", titleAr: "تمت صياغة خطة عمل بالذكاء الاصطناعي بانتظار المراجعة", staffOnly: true, sensitivity: data.c.sensitivity } });
  revalidatePath(`/cases/${caseId}`);
  return { status: "ok" as const, planId: plan.id, interactionId: res.interactionId };
}

export async function updatePlanItemAction(input: { itemId: string; text?: string; remove?: boolean }) {
  const ctx = await getCtx();
  const item = await ctx.db.actionPlanItem.findUnique({ where: { id: input.itemId }, include: { plan: true } });
  if (!item || item.plan.status !== "DRAFT") return { ok: false };
  if (input.remove) await ctx.db.actionPlanItem.delete({ where: { id: item.id } });
  else if (input.text?.trim()) await ctx.db.actionPlanItem.update({ where: { id: item.id }, data: { textEn: input.text.trim(), textAr: input.text.trim() } });
  revalidatePath(`/cases/${item.plan.caseId}`);
  return { ok: true };
}

/** A person approves the plan: steps become tasks for the student and staff, and the family gets an update when appropriate. */
export async function approvePlanAction(input: { planId: string; notifyParents: boolean }) {
  const ctx = await getCtx();
  const plan = await ctx.db.actionPlan.findUnique({ where: { id: input.planId }, include: { items: { orderBy: { order: "asc" } }, case: true } });
  if (!plan || plan.status !== "DRAFT" || !plan.case) return { ok: false };
  if (!(await canViewCase(ctx, plan.case, { audit: false }))) return { ok: false };
  const student = await ctx.db.student.findUnique({ where: { id: plan.studentId }, include: { guardians: { include: { guardian: true } } } });
  const sensitive = SENSITIVE.includes(plan.case.sensitivity);
  const { tenantTx } = await import("@/lib/tenant-db");
  const { execCtx } = await import("@/server/db");
  const { notify } = await import("@/server/notify/notify");
  const { flushEffects } = await import("@/server/queue");
  const effects: import("@/server/db").Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    for (const it of plan.items) {
      if (it.ownerRole === "parent") continue;
      const assignee = it.ownerRole === "student" ? student?.membershipId ?? null : plan.case!.assigneeId ?? ctx.membershipId;
      const task = await tx.task.create({
        data: {
          orgId: ctx.orgId,
          titleEn: it.textEn,
          titleAr: it.textAr,
          dueAt: it.dueAt,
          assigneeId: assignee,
          createdById: ctx.membershipId,
          caseId: it.ownerRole === "student" ? null : plan.caseId,
          studentId: plan.studentId,
          sensitivity: it.ownerRole === "student" ? "STANDARD" : plan.case!.sensitivity,
          href: it.ownerRole === "student" ? (/subject/i.test(it.textEn) || /المادة/.test(it.textEn) ? "/services/subject_change" : "/career") : `/cases/${plan.caseId}`,
        },
      });
      await tx.actionPlanItem.update({ where: { id: it.id }, data: { taskId: task.id } });
    }
    await tx.actionPlan.update({ where: { id: plan.id }, data: { status: "ACCEPTED", approvedById: ctx.membershipId, approvedAt: new Date() } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: plan.caseId, studentId: plan.studentId, actorId: ctx.membershipId, kind: "status", titleEn: "Action plan approved and shared as tasks", titleAr: "تم اعتماد خطة العمل ومشاركتها كمهام", staffOnly: true, sensitivity: plan.case!.sensitivity } });
    const ec = execCtx(tx, ctx.orgId, { effects });
    if (student?.membershipId) {
      await notify(ec, {
        recipients: [student.membershipId],
        templateKey: "task_assigned",
        vars: { title: { en: plan.titleEn, ar: plan.titleAr }, when: { en: "this month", ar: "هذا الشهر" } },
        href: "/tasks",
        channels: ["IN_APP"],
        idempotencyBase: `plan:${plan.id}:student`,
      });
    }
    // Parents hear about sensitive cases only through a recorded decision, never from here.
    if (input.notifyParents && !sensitive && student) {
      const parentIds = student.guardians.filter((g) => g.receivesUpdates).map((g) => g.guardian.membershipId).filter(Boolean) as string[];
      const parentSteps = plan.items.filter((i) => i.ownerRole === "parent").map((i) => i.textEn);
      const msgEn = `${ctx.user.nameEn} has agreed an action plan with ${student.firstNameEn}: "${plan.titleEn}". ${parentSteps.length ? `How you can help: ${parentSteps.join("; ")}.` : ""}`;
      const msgAr = `اتفق ${ctx.user.nameAr ?? ctx.user.nameEn} مع ${student.firstNameAr} على خطة عمل: "${plan.titleAr}". ${parentSteps.length ? `كيف يمكنكم المساعدة: ${plan.items.filter((i) => i.ownerRole === "parent").map((i) => i.textAr).join("؛ ")}.` : ""}`;
      await notify(ec, {
        recipients: parentIds,
        templateKey: "parent_update",
        vars: { student: { en: student.firstNameEn, ar: student.firstNameAr }, message: { en: msgEn, ar: msgAr } },
        href: "/home",
        channels: ["IN_APP", "EMAIL"],
        idempotencyBase: `plan:${plan.id}:parents`,
      });
      for (const g of student.guardians.filter((x) => x.receivesUpdates)) {
        await tx.message.create({ data: { orgId: ctx.orgId, caseId: plan.caseId, channel: "EMAIL", fromId: ctx.membershipId, toGuardianId: g.guardianId, toLabel: `${g.guardian.firstNameEn} ${g.guardian.lastNameEn}`, subject: `Action plan for ${student.firstNameEn}`, body: msgEn } });
      }
    }
  });
  await flushEffects(effects);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function discardPlanAction(planId: string) {
  const ctx = await getCtx();
  const plan = await ctx.db.actionPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.status !== "DRAFT") return { ok: false };
  await ctx.db.actionPlan.update({ where: { id: planId }, data: { status: "DISCARDED" } });
  revalidatePath(`/cases/${plan.caseId}`);
  return { ok: true };
}

export async function reviewAiAction(interactionId: string, accepted: boolean) {
  const ctx = await getCtx();
  await reviewAi(ctx, interactionId, accepted);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Teacher referral draft from quick notes
// ---------------------------------------------------------------------------

export type ReferralDraft = { observations: string; concernAreas: string[]; actionsTaken: string; urgency: "low" | "medium" | "high" };
const isReferral = (v: unknown): v is ReferralDraft => {
  const o = v as ReferralDraft;
  return Boolean(o) && typeof o.observations === "string" && isStrArr(o.concernAreas) && typeof o.actionsTaken === "string" && ["low", "medium", "high"].includes(o.urgency);
};
const AREAS: Array<[string, RegExp]> = [
  ["grades_declining", /grade|mark|score|fail|drop|درج|علام/i],
  ["missing_homework", /homework|assignment|deadline|واجب/i],
  ["low_participation", /quiet|particip|engag|withdrawn|مشارك/i],
  ["attendance", /absen|late|attend|غياب|تأخر/i],
  ["understanding_gaps", /understand|confus|struggl|concept|فهم/i],
  ["exam_anxiety", /anx|nervous|stress|exam|test|قلق|امتحان/i],
];

export async function referralDraftAction(input: { notes: string }) {
  const ctx = await getCtx();
  if (!ctx.isStaff) return { status: "error" as const };
  const notes = input.notes.slice(0, 2000);
  return generateAi<ReferralDraft>(ctx, {
    feature: "referral_draft",
    sensitive: false,
    instructions:
      "Turn the teacher's quick notes into a clear academic concern referral. Observations are factual and specific. Concern areas must be chosen only from: grades_declining, missing_homework, low_participation, attendance, understanding_gaps, exam_anxiety. Urgency is low, medium or high.",
    outputShape: '{"observations": string, "concernAreas": string[], "actionsTaken": string, "urgency": "low"|"medium"|"high"}',
    facts: { teacherNotes: notes },
    fallback: () => {
      const areas = AREAS.filter(([, re]) => re.test(notes)).map(([k]) => k);
      const sentences = notes.split(/(?<=[.!?؟])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
      const actions = sentences.filter((s) => /spoke|talked|offered|emailed|called|moved|تحدث|عرضت|اتصلت/i.test(s));
      const observed = sentences.filter((s) => !actions.includes(s));
      const urgent = /urgent|serious|very worried|failing|قلق جدا|عاجل/i.test(notes);
      return {
        observations: observed.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") || notes,
        concernAreas: areas.length ? areas : ["understanding_gaps"],
        actionsTaken: actions.join(" ") || (ctx.locale === "ar" ? "لم تُتخذ إجراءات بعد." : "No actions taken yet."),
        urgency: urgent ? "high" : areas.length >= 3 ? "medium" : "low",
      };
    },
    validate: (v): v is ReferralDraft => isReferral(v) && v.concernAreas.every((a) => AREAS.some(([k]) => k === a)),
  });
}

// ---------------------------------------------------------------------------
// Admin questions over aggregate KPIs (no personal data)
// ---------------------------------------------------------------------------

export type AdminAnswer = { answer: string; bullets: string[] };
export async function adminQuestionAction(question: string) {
  const ctx = await getCtx();
  if (!ctx.can("ai.admin_insights")) return { status: "error" as const };
  const k = await schoolKpis(ctx, 30);
  const ar = ctx.locale === "ar";
  return generateAi<AdminAnswer>(ctx, {
    feature: "admin_question",
    sensitive: false,
    instructions: `Answer the school leader's question using only these aggregate figures. Question: "${question.slice(0, 300)}"`,
    outputShape: '{"answer": string, "bullets": string[]}',
    facts: { last30Days: k },
    fallback: () => {
      const q = question.toLowerCase();
      if (/slow|longest|بطء|أبطأ|تأخ/.test(q)) {
        return {
          answer: ar ? `أبطأ خدمة خلال آخر 30 يومًا هي "${k.slowest[0]?.label ?? "-"}" بمتوسط ${k.slowest[0]?.value ?? 0} ساعة للإغلاق.` : `The slowest service in the last 30 days is "${k.slowest[0]?.label ?? "-"}", averaging ${k.slowest[0]?.value ?? 0} hours to close.`,
          bullets: k.slowest.map((s) => (ar ? `${s.label}: ${s.value} ساعة (${s.count} طلبات)` : `${s.label}: ${s.value}h across ${s.count} requests`)),
        };
      }
      if (/sla|target|on time|المدة|مستوى/.test(q)) {
        return { answer: ar ? `أُنجز ${k.sla}% من الطلبات ضمن المدة المستهدفة خلال آخر 30 يومًا.` : `${k.sla}% of requests were closed within target in the last 30 days.`, bullets: [ar ? `متوسط مدة الإنجاز ${k.avgResolutionHours} ساعة` : `Average resolution ${k.avgResolutionHours}h`, ar ? `الطلبات المفتوحة الآن ${k.requests.open}` : `${k.requests.open} requests open now`] };
      }
      return {
        answer: ar ? `تلقت المدرسة ${k.requests.thisPeriod} طلبًا خلال آخر 30 يومًا (${k.requests.delta >= 0 ? "+" : ""}${k.requests.delta}% مقارنة بالفترة السابقة).` : `The school received ${k.requests.thisPeriod} requests in the last 30 days (${k.requests.delta >= 0 ? "+" : ""}${k.requests.delta}% on the previous period).`,
        bullets: k.byService.slice(0, 4).map((s) => `${s.label}: ${s.value}`),
      };
    },
    validate: (v): v is AdminAnswer => Boolean(v) && typeof (v as AdminAnswer).answer === "string" && isStrArr((v as AdminAnswer).bullets),
  });
}
