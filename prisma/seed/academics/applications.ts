// Demo data for the university application tracker. Runs after the pathways seed and is safe to re-run:
// global deadline rows are found by (university, intake, kind) and updated; applications are only created
// for students who have none for the coming intake; tasks and letters use the module's idempotency keys.
// Programmes and universities are looked up at runtime by key (school rows or the global catalog) and
// skipped when missing. Adam Nasser is in Grade 9, so he has no applications.
import type { PrismaClient, ApplicationStage } from "@prisma/client";
import type { Tx } from "@/server/db";
import { execCtx } from "@/server/db";
import { assignRecommendation, generateTasks, startApplication } from "@/server/applications/service";
import { intakeYearFor } from "@/server/applications/types";
import type { SeedWorld } from "../demo";

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));
const EXAMPLE_NOTE = "Example date. Confirm on the official admissions page.";

/** University-level deadlines in the global catalog (orgId null). Owner client only. */
const GLOBAL_DEADLINES: Array<{ uni: string; kind: string; month: number; day: number; prevYear?: boolean }> = [
  { uni: "cambridge", kind: "OXBRIDGE_MEDICINE", month: 10, day: 15, prevYear: true },
  { uni: "oxford", kind: "OXBRIDGE_MEDICINE", month: 10, day: 15, prevYear: true },
  { uni: "ucl", kind: "UCAS_EQUAL", month: 1, day: 14 },
  { uni: "imperial_college_london", kind: "UCAS_EQUAL", month: 1, day: 14 },
  { uni: "mit", kind: "EA", month: 11, day: 1, prevYear: true },
  { uni: "mit", kind: "RD", month: 1, day: 5 },
  { uni: "stanford", kind: "EA", month: 11, day: 1, prevYear: true },
  { uni: "stanford", kind: "RD", month: 1, day: 5 },
  { uni: "nyu_abu_dhabi", kind: "ED", month: 11, day: 1, prevYear: true },
  { uni: "nyu_abu_dhabi", kind: "RD", month: 1, day: 5 },
  { uni: "university_of_toronto", kind: "OUAC_EQUAL", month: 1, day: 15 },
  { uni: "khalifa_university", kind: "UAE_WINDOW", month: 5, day: 31 },
];

export async function seedGlobalApplicationDeadlines(db: PrismaClient, now = new Date(), log: (m: string) => void = () => {}) {
  const intake = intakeYearFor(12, now);
  const unis = await db.university.findMany({ where: { orgId: null, key: { in: [...new Set(GLOBAL_DEADLINES.map((d) => d.uni))] } }, select: { id: true, key: true } });
  let n = 0;
  for (const d of GLOBAL_DEADLINES) {
    const u = unis.find((x) => x.key === d.uni);
    if (!u) continue;
    const date = utc(d.prevYear ? intake - 1 : intake, d.month, d.day);
    const existing = await db.applicationDeadline.findFirst({ where: { orgId: null, universityId: u.id, programId: null, intakeYear: intake, kind: d.kind } });
    if (existing) await db.applicationDeadline.update({ where: { id: existing.id }, data: { date, noteEn: EXAMPLE_NOTE } });
    else await db.applicationDeadline.create({ data: { orgId: null, universityId: u.id, programId: null, intakeYear: intake, kind: d.kind, date, noteEn: EXAMPLE_NOTE } });
    n++;
  }
  log(`applications: ${n} global deadline rows`);
  return n;
}

export async function seedApplications(w: SeedWorld) {
  // Global deadlines come only from official pages (prisma/seed/catalog/official.ts).
  await seedApplicationsFor(w.db, w.orgId, w.now, w.log);
}

type Plan = {
  program: string;
  stage: ApplicationStage;
  /** Days ago the application was started. */
  startedDaysAgo: number;
  counselor: "counselor" | "career_advisor";
  decisionPlan?: string;
  /** Checklist kinds already done. */
  done?: string[];
  inProgress?: string[];
  /** Stage history, oldest first, days ago. */
  history?: Array<{ to: ApplicationStage; daysAgo: number }>;
  /** Ask Daniel Carter for the first recommendation letter. */
  letterFromTeacher?: boolean;
};

// One entry per student slot (Grade 12, in the order found). Each has two or three applications.
const STORIES: Plan[][] = [
  [
    { program: "cambridge-computer-science-ba", stage: "PREPARING", startedDaysAgo: 70, counselor: "career_advisor", done: ["PASSPORT", "TRANSCRIPT", "PREDICTED_GRADES"], inProgress: ["PERSONAL_STATEMENT"], history: [{ to: "PREPARING", daysAgo: 70 }], letterFromTeacher: true },
    { program: "ucl-computer-science-bsc", stage: "PREPARING", startedDaysAgo: 60, counselor: "career_advisor", done: ["PASSPORT", "TRANSCRIPT"], inProgress: ["PERSONAL_STATEMENT"] },
    { program: "imperial-computing-beng", stage: "PREPARING", startedDaysAgo: 45, counselor: "career_advisor", done: ["PASSPORT"] },
  ],
  [
    { program: "nyuad-computer-science-bs", stage: "PREPARING", startedDaysAgo: 90, counselor: "counselor", decisionPlan: "ED", done: ["PASSPORT", "TRANSCRIPT", "ESSAY"], inProgress: ["FINANCIAL"], history: [{ to: "PREPARING", daysAgo: 90 }] },
    { program: "cmu-computer-science-bs", stage: "PREPARING", startedDaysAgo: 40, counselor: "counselor", decisionPlan: "RD", done: ["PASSPORT"] },
    { program: "ku-computer-science-bsc", stage: "OFFER", startedDaysAgo: 120, counselor: "counselor", done: ["PASSPORT", "TRANSCRIPT", "FORM"], history: [{ to: "SUBMITTED", daysAgo: 75 }, { to: "OFFER", daysAgo: 12 }] },
  ],
  [
    { program: "uoft-computer-science-bsc", stage: "PREPARING", startedDaysAgo: 50, counselor: "career_advisor", done: ["PASSPORT", "PREDICTED_GRADES"] },
    { program: "waterloo-computer-science-bcs", stage: "SUBMITTED", startedDaysAgo: 110, counselor: "career_advisor", done: ["PASSPORT", "PREDICTED_GRADES", "TRANSCRIPT", "ESSAY", "FORM"], history: [{ to: "SUBMITTED", daysAgo: 20 }] },
  ],
  [
    { program: "uaeu-medicine-md", stage: "INTERVIEW", startedDaysAgo: 150, counselor: "counselor", done: ["PASSPORT", "TRANSCRIPT", "FORM", "TEST", "LANGUAGE_TEST"], history: [{ to: "SUBMITTED", daysAgo: 60 }, { to: "INTERVIEW", daysAgo: 9 }] },
    { program: "manchester-medicine-mbchb", stage: "PREPARING", startedDaysAgo: 65, counselor: "counselor", done: ["PASSPORT", "PREDICTED_GRADES"], inProgress: ["PERSONAL_STATEMENT", "TEST"] },
  ],
  [
    { program: "aus-architecture-barch", stage: "WAITLISTED", startedDaysAgo: 160, counselor: "career_advisor", done: ["PASSPORT", "TRANSCRIPT", "PERSONAL_STATEMENT", "FORM"], history: [{ to: "SUBMITTED", daysAgo: 95 }, { to: "WAITLISTED", daysAgo: 25 }] },
    { program: "ucl-architecture-bsc", stage: "PREPARING", startedDaysAgo: 30, counselor: "career_advisor", inProgress: ["PORTFOLIO", "PERSONAL_STATEMENT"] },
    { program: "stanford-computer-science-bs", stage: "SHORTLISTED", startedDaysAgo: 14, counselor: "career_advisor" },
  ],
];

export async function seedApplicationsFor(db: PrismaClient, orgId: string, now = new Date(), log: (m: string) => void = () => {}) {
  const tx = db as unknown as Tx;
  const intake = intakeYearFor(12, now);
  const personas = await db.demoPersona.findMany({ where: { orgId, key: { in: ["counselor", "career_advisor", "teacher"] } } });
  const persona = (k: string) => personas.find((p) => p.key === k)?.membershipId ?? null;
  // Grade 12 students with an account, American-track first so the Common App stories read naturally.
  const seniors = await db.student.findMany({ where: { orgId, gradeLevel: 12, status: "ACTIVE", membershipId: { not: null } }, orderBy: [{ lastNameEn: "asc" }] });
  const american = seniors.filter((s) => s.curriculum === "AMERICAN");
  const british = seniors.filter((s) => s.curriculum !== "AMERICAN");
  // Slot 1 (NYUAD, CMU, KU) suits the American track; the rest suit the British track.
  const order = [british[0], american[0] ?? british[5], british[1], british[2], british[3]].filter(Boolean);

  // A school-entered programme deadline and university window, so the demo shows every source label.
  await schoolDeadlines(db, orgId, intake);

  let created = 0;
  let letters = 0;
  for (let i = 0; i < order.length && i < STORIES.length; i++) {
    const student = order[i];
    const already = await db.application.count({ where: { orgId, studentId: student.id, intakeYear: { gte: intake } } });
    if (already) continue;
    for (const plan of STORIES[i]) {
      const program = await db.universityProgram.findFirst({ where: { key: plan.program, OR: [{ orgId }, { orgId: null }] }, orderBy: { orgId: { sort: "asc", nulls: "last" } } });
      if (!program) continue;
      const started = new Date(now.getTime() - plan.startedDaysAgo * DAY);
      const res = await startApplication(tx, orgId, { studentId: student.id, programId: program.id, actorId: persona(plan.counselor), counselorId: persona(plan.counselor), decisionPlan: plan.decisionPlan ?? null, stage: "PREPARING", intakeYear: intake, now: started });
      if (!res.ok || !res.created) continue;
      created++;
      const appId = res.applicationId;
      // Backdate the start event so the timeline shows months of history.
      await db.auditEvent.updateMany({ where: { orgId, entityType: "Application", entityId: appId, action: "applications.start" }, data: { createdAt: started } });
      if (plan.stage === "SHORTLISTED") {
        await db.application.update({ where: { id: appId }, data: { stage: "SHORTLISTED" } });
        await db.auditEvent.create({ data: { orgId, actorId: persona(plan.counselor), action: "applications.stage", entityType: "Application", entityId: appId, meta: { from: "PREPARING", to: "SHORTLISTED" }, createdAt: new Date(started.getTime() + DAY) } });
      }
      // Checklist progress.
      const items = await db.applicationRequirement.findMany({ where: { orgId, applicationId: appId } });
      for (const it of items) {
        const status = plan.done?.includes(it.kind) ? "DONE" : plan.inProgress?.includes(it.kind) ? "IN_PROGRESS" : null;
        if (status && it.kind !== "RECOMMENDATION") await db.applicationRequirement.update({ where: { id: it.id }, data: { status } });
      }
      // Stage history, with backdated audit events and dates.
      let from: ApplicationStage = "PREPARING";
      for (const h of plan.history ?? []) {
        const at = new Date(now.getTime() - h.daysAgo * DAY);
        if (h.to !== from) {
          await db.application.update({ where: { id: appId }, data: { stage: h.to, ...(h.to === "SUBMITTED" ? { submittedAt: at } : {}), ...(["OFFER", "REJECTED", "WAITLISTED"].includes(h.to) ? { decidedAt: at } : {}) } });
          await db.auditEvent.create({ data: { orgId, actorId: persona(plan.counselor), action: "applications.stage", entityType: "Application", entityId: appId, meta: { from, to: h.to }, createdAt: at } });
          from = h.to;
        }
      }
      // Submitted applications have their recommendation letters in already.
      if (!["PREPARING", "SHORTLISTED", "RESEARCHING"].includes(plan.stage)) await db.applicationRequirement.updateMany({ where: { orgId, applicationId: appId, kind: "RECOMMENDATION" }, data: { status: "DONE" } });
      if (plan.letterFromTeacher && persona("teacher")) {
        const rec = items.find((x) => x.kind === "RECOMMENDATION");
        if (rec) {
          const r = await assignRecommendation(execCtx(tx, orgId, { now: new Date(now.getTime() - 6 * DAY), quiet: true }), { itemId: rec.id, teacherId: persona("teacher")!, actorId: persona(plan.counselor) });
          if (r.ok) letters++;
        }
      }
      await generateTasks(tx, orgId, appId, { now, actorId: persona(plan.counselor) });
      // Backdate the planning events too: letters were requested last week, tasks planned yesterday.
      await db.auditEvent.updateMany({ where: { orgId, entityType: "Application", entityId: appId, action: "applications.letter.assign" }, data: { createdAt: new Date(now.getTime() - 6 * DAY) } });
      await db.auditEvent.updateMany({ where: { orgId, entityType: "Application", entityId: appId, action: "applications.tasks.generate" }, data: { createdAt: new Date(now.getTime() - DAY) } });
    }
  }
  log(`applications: ${created} applications, ${letters} letter requests`);
  return { created, letters };
}

async function schoolDeadlines(db: PrismaClient, orgId: string, intake: number) {
  const rows: Array<{ program?: string; uni?: string; kind: string; date: Date; noteEn: string }> = [
    { program: "waterloo-computer-science-bcs", kind: "OUAC_EQUAL", date: utc(intake, 2, 1), noteEn: "Entered by the careers office from the Waterloo admissions page." },
    { program: "waterloo-computer-science-bcs", kind: "REPLY", date: utc(intake, 6, 1), noteEn: "Offer reply date." },
    { uni: "american_university_sharjah", kind: "REGULAR", date: utc(intake, 3, 1), noteEn: "Priority deadline entered by the careers office." },
    { uni: "american_university_sharjah", kind: "DECISION", date: utc(intake, 4, 15), noteEn: "Final waitlist decisions." },
    { uni: "uae_university", kind: "INTERVIEW", date: utc(intake - 1, 10, 20), noteEn: "Multiple mini interview day." },
    { uni: "khalifa_university", kind: "REPLY", date: utc(intake - 1, 11, 15), noteEn: "Accept the offer and pay the seat deposit." },
  ];
  for (const r of rows) {
    const program = r.program ? await db.universityProgram.findFirst({ where: { key: r.program, OR: [{ orgId }, { orgId: null }] } }) : null;
    const uni = r.uni ? await db.university.findFirst({ where: { key: r.uni, OR: [{ orgId }, { orgId: null }] }, orderBy: { orgId: { sort: "asc", nulls: "last" } } }) : null;
    if (r.program && !program) continue;
    if (r.uni && !uni) continue;
    const universityId = program?.universityId ?? uni!.id;
    const where = { orgId, universityId, programId: program?.id ?? null, intakeYear: intake, kind: r.kind };
    const existing = await db.applicationDeadline.findFirst({ where });
    if (existing) await db.applicationDeadline.update({ where: { id: existing.id }, data: { date: r.date, noteEn: r.noteEn } });
    else await db.applicationDeadline.create({ data: { ...where, date: r.date, noteEn: r.noteEn } });
  }
}
