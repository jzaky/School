// Months of realistic history for the demo school. In-flight requests run through the real
// workflow engine with backdated clocks, so approvals, cases and tasks behave exactly like live ones.
import type { Prisma } from "@prisma/client";
import type { ExecCtx } from "@/server/db";
import { execCtx } from "@/server/db";
import type { FormField, FormSchema } from "@/server/forms/schema";
import { submitRequest } from "@/server/services/submit";
import { decideApproval } from "@/server/workflows/approvals";
import { resumeRunsForTask, advanceRun } from "@/server/workflows/engine";
import { at, id, rng, schoolDay } from "./lib";
import { CASE_STORIES, REQUEST_NOTES, TASK_TITLES } from "./data/content";
import type { SeedStudent, SeedWorld } from "./demo";

type Bi = { en: string; ar: string };

let STAFF_PICK = "";

function sampleValue(f: FormField, r: ReturnType<typeof rng>, s: SeedStudent | null, requesterName: string): unknown {
  switch (f.type) {
    case "staff_picker":
      return f.type === "staff_picker" && STAFF_PICK ? [STAFF_PICK].join("") : "";
    case "file":
      return { name: "attachment.pdf", size: 120000, key: "sample:attachment" };
    case "short_text":
      if (f.prefill === "student.fullName" && s) return `${s.first.en} ${s.last.en}`;
      if (f.prefill === "student.grade" && s) return String(s.grade);
      if (f.prefill === "requester.name") return requesterName;
      return f.placeholder?.en?.replace(/^For example,?\s*/i, "") || "See details";
    case "long_text":
      return "Details shared with the school office.";
    case "number":
      return f.min ?? 1;
    case "email":
      return "family@horizon.example";
    case "phone":
      return "+971 50 555 0199";
    case "date":
      return new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    case "time":
      return "13:30";
    case "select":
    case "radio":
      return f.options?.[0]?.value ?? "";
    case "multi_select":
      return f.options?.slice(0, 2).map((o) => o.value) ?? [];
    case "checkbox":
    case "consent":
      return true;
    case "yes_no":
      return r.chance(0.6);
    case "rating":
      return 4;
    case "scale":
      return Math.min(f.max ?? 5, 4);
    case "student_picker":
      return s?.id ?? "";
    case "subject_picker":
      return s?.subjects.find((c) => !["MATH", "ENG", "ARAB", "ISL", "PE"].includes(c)) ?? "MATH";
    case "signature":
      return requesterName;
    default:
      return undefined;
  }
}

export function sampleData(schema: FormSchema | null, s: SeedStudent | null, requesterName: string, overrides: Record<string, unknown> = {}, seed = 1) {
  if (!schema) return overrides;
  const r = rng(seed);
  const out: Record<string, unknown> = {};
  for (const step of schema.steps) for (const sec of step.sections) for (const f of sec.fields) {
    if (f.type === "statement" || (f.type === "file" && !f.required)) continue;
    if (!f.required && !f.prefill && r.chance(0.35)) continue;
    const v = sampleValue(f, r, s, requesterName);
    if (v !== undefined && v !== "") out[f.id] = v;
  }
  return { ...out, ...overrides };
}

export async function seedHistory(w: SeedWorld, base: ExecCtx) {
  const { db, orgId, now, staff } = w;
  const r = rng(424242);
  STAFF_PICK = staff.get("deputy_dsl_main")?.membershipId ?? "";
  const S = (key: string) => staff.get(key)!;
  const tx = db as unknown as Prisma.TransactionClient;
  const ec = (when: Date, actorId?: string | null) => execCtx(tx, orgId, { now: when, quiet: true, actorId: actorId ?? null });
  const grade = (g: number) => w.students.filter((s) => s.grade === g && s !== w.adam && s !== w.yara);
  const guardiansOf = (s: SeedStudent) => w.guardians.filter((g) => g.studentIds.includes(s.id));
  const nameOf = (membershipId: string) => {
    for (const s of staff.values()) if (s.membershipId === membershipId) return s.name.en;
    const g = w.guardians.find((x) => x.membershipId === membershipId);
    if (g) return g.name.en;
    const st = w.students.find((x) => x.membershipId === membershipId);
    return st ? `${st.first.en} ${st.last.en}` : "";
  };

  let seedCounter = 1;
  let clampCounter = 0;
  /** History must never sit in the future: clamp to a few minutes before now. */
  const past = (when: Date) => (when.getTime() < now.getTime() - 60_000 ? when : new Date(now.getTime() - 60_000 * (30 - Math.min(++clampCounter, 25))));
  async function submit(serviceKey: string, requesterId: string, student: SeedStudent | null, when: Date, overrides: Record<string, unknown> = {}, appointmentId?: string | null) {
    const svc = w.services.get(serviceKey);
    if (!svc) throw new Error(`service ${serviceKey} missing`);
    const data = sampleData(svc.schema, student, nameOf(requesterId), overrides, seedCounter++);
    when = past(when);
    return submitRequest(ec(when, requesterId), { serviceId: svc.id, requesterId, studentId: student?.id ?? null, data, appointmentId });
  }

  async function decide(requestId: string, deciderId: string, decision: "APPROVED" | "REJECTED", when: Date, comment?: string) {
    const row = await db.approvalAssignee.findFirst({
      where: { orgId, membershipId: deciderId, status: "PENDING", approval: { requestId, status: "PENDING" } },
      include: { approval: true },
    });
    if (!row) return false;
    when = past(when);
    await decideApproval(ec(when, deciderId), {
      assigneeRowId: row.id,
      deciderMembershipId: deciderId,
      decision,
      comment: comment ?? null,
      signatureName: row.requireSignature ? nameOf(deciderId) : null,
    });
    return true;
  }

  async function completeTasksFor(requestId: string, when: Date) {
    when = past(when);
    const tasks = await db.task.findMany({ where: { orgId, requestId, status: { not: "DONE" } } });
    for (const t of tasks) {
      await db.task.update({ where: { id: t.id }, data: { status: "DONE", completedAt: when } });
      await resumeRunsForTask(ec(when), t.id);
    }
  }

  const pendingApprover = async (requestId: string) => {
    const row = await db.approvalAssignee.findFirst({ where: { orgId, status: "PENDING", approval: { requestId, status: "PENDING" } } });
    return row?.membershipId ?? null;
  };

  // ------------------------------------------------------------------
  // Adam Nasser's history
  // ------------------------------------------------------------------
  const adam = w.adam;
  const daniel = S("daniel_carter").membershipId;
  const registrar = S("registrar_main").membershipId;
  const sarah = S("sarah_ahmed").membershipId;
  const layla = S("layla_hassan").membershipId;
  const omar = S("omar_al_mansoori").membershipId;
  const aisha = S("aisha_rahman").membershipId;

  {
    const req = await submit("document_request", w.rania.membershipId, adam, at(schoolDay(-48, now), 19, 10, now), {
      documentType: "enrollment_letter",
      language: "bilingual",
      purpose: "visa",
      copies: 1,
    });
    await decide(req.id, registrar, "APPROVED", at(schoolDay(-47, now), 9, 40, now), "Issued for the residence visa renewal.");
  }
  {
    const req = await submit("it_support", adam.membershipId, adam, at(schoolDay(-30, now), 8, 5, now));
    await completeTasksFor(req.id, at(schoolDay(-30, now), 11, 20, now));
  }
  {
    const req = await submit("locker_request", adam.membershipId, adam, at(schoolDay(-22, now), 12, 45, now));
    await completeTasksFor(req.id, at(schoolDay(-21, now), 10, 0, now));
  }
  {
    const req = await submit("absence_request", w.rania.membershipId, adam, at(schoolDay(-9, now), 7, 2, now));
    await decide(req.id, daniel, "APPROVED", at(schoolDay(-9, now), 8, 15, now), "Get well soon, Adam.");
  }
  // Adam asks to join the robotics club. Waiting for Daniel.
  await submit("activity_registration", adam.membershipId, adam, at(schoolDay(-1, now), 15, 20, now), { activity: "robotics" });

  // Yara: a learning support referral from her English teacher, waiting for Rania's signed consent.
  const yaraEnglish = w.classes.find((c) => c.grade === 6 && c.subject === "ENG")?.teacherId ?? daniel;
  await submit("learning_support_referral", yaraEnglish, w.yara, at(schoolDay(-2, now), 13, 15, now), { student: w.yara.id, subject: "ENG" });
  {
    // Rania met Yara's homeroom teacher last month (completed).
    const tutor = w.classes.find((c) => c.homeroom && c.grade === 6 && c.section === w.yara.section)!.teacherId!;
    await createAppointment("parent_teacher_meeting", tutor, w.rania.membershipId, w.yara, at(schoolDay(-18, now), 15, 0, now), "COMPLETED", { guardianId: w.rania.id });
  }

  // ------------------------------------------------------------------
  // Subject changes at every stage
  // ------------------------------------------------------------------
  const tenPhys = grade(10).filter((s) => s.subjects.includes("PHYS"));
  const nineBPhys = grade(9).filter((s) => s.section === "B");
  {
    // Completed three weeks ago: Physics to Computer Science, Grade 9B.
    const s = nineBPhys[0];
    const g = guardiansOf(s)[0];
    const req = await submit("subject_change", s.membershipId, s, at(schoolDay(-19, now), 16, 30, now), { fromSubject: "PHYS", toSubject: "CS", reason: "career", careerLink: "Software developer", parentAware: true });
    await decide(req.id, g.membershipId, "APPROVED", at(schoolDay(-18, now), 20, 5, now), "We support this change.");
    await decide(req.id, daniel, "APPROVED", at(schoolDay(-17, now), 10, 10, now), "Strong programmer, a good move.");
    await decide(req.id, S("hod_computing").membershipId, "APPROVED", at(schoolDay(-16, now), 9, 0, now), "Space available in CS 9.");
    await decide(req.id, registrar, "APPROVED", at(schoolDay(-15, now), 11, 30, now), "Timetable updated from next week.");
  }
  {
    // Waiting for the Head of Computing.
    const s = tenPhys[0] ?? grade(10)[0];
    const g = guardiansOf(s)[0];
    const req = await submit("subject_change", s.membershipId, s, at(schoolDay(-4, now), 17, 0, now), { fromSubject: "PHYS", toSubject: "CS", reason: "interest", parentAware: true });
    await decide(req.id, g.membershipId, "APPROVED", at(schoolDay(-3, now), 21, 10, now));
    const teacher = await pendingApprover(req.id);
    if (teacher) await decide(req.id, teacher, "APPROVED", at(schoolDay(-2, now), 12, 40, now), "Happy to support.");
  }
  {
    // Waiting for the Registrar.
    const s = grade(11).find((x) => x.subjects.includes("CHEM")) ?? grade(11)[0];
    const g = guardiansOf(s)[0];
    const req = await submit("subject_change", s.membershipId, s, at(schoolDay(-6, now), 14, 0, now), { fromSubject: "CHEM", toSubject: "ECON", reason: "career", careerLink: "Financial analyst", parentAware: true });
    await decide(req.id, g.membershipId, "APPROVED", at(schoolDay(-6, now), 19, 30, now));
    for (let i = 0; i < 2; i++) {
      const next = await pendingApprover(req.id);
      if (next && next !== registrar) await decide(req.id, next, "APPROVED", at(schoolDay(-5 + i, now), 10 + i, 15, now));
    }
  }

  // ------------------------------------------------------------------
  // Document requests
  // ------------------------------------------------------------------
  const docPurposes = ["visa", "embassy", "bank", "university"];
  for (let i = 0; i < 7; i++) {
    const s = r.pick(w.students.filter((x) => x !== w.adam && x !== w.yara));
    const g = guardiansOf(s)[0];
    const day = schoolDay(-(8 + i * 11), now);
    const req = await submit("document_request", g.membershipId, s, at(day, 18, 20, now), {
      documentType: i % 3 === 0 ? "transcript" : "enrollment_letter",
      language: r.pick(["en", "ar", "bilingual"]),
      purpose: docPurposes[i % 4],
      addressedTo: ["", "Embassy of Canada, Abu Dhabi", "Emirates NBD, Customer Service", "Office of Undergraduate Admissions"][i % 4] || undefined,
      copies: 1,
    });
    await decide(req.id, registrar, i === 4 ? "REJECTED" : "APPROVED", at(day + 1, 10, 5, now), i === 4 ? "The student record needs updating first. Please visit the Registrar's office." : undefined);
  }
  for (let i = 0; i < 3; i++) {
    const s = r.pick(w.students.filter((x) => x !== w.adam && x !== w.yara));
    const g = guardiansOf(s)[0];
    await submit("document_request", i === 2 ? s.membershipId : g.membershipId, s, at(schoolDay(-i, now), 8 + i * 3, 30, now), {
      documentType: i === 1 ? "good_conduct" : "enrollment_letter",
      language: "bilingual",
      purpose: i === 0 ? "embassy" : "visa",
      addressedTo: i === 0 ? "Embassy of the United Kingdom, Dubai" : undefined,
      copies: 1,
    });
  }

  // ------------------------------------------------------------------
  // Homeroom approvals (absences, activities) and principal approvals
  // ------------------------------------------------------------------
  const nineA = grade(9).filter((s) => s.section === "A");
  for (let i = 0; i < 2; i++) {
    const s = nineA[i];
    const g = guardiansOf(s)[0];
    await submit("absence_request", g.membershipId, s, at(schoolDay(-i, now), 6 + i, 45, now));
  }
  for (let i = 0; i < 8; i++) {
    const s = r.pick(w.students.filter((x) => x.grade !== 9));
    const g = guardiansOf(s)[0];
    const day = schoolDay(-(3 + i * 6), now);
    const req = await submit(i % 3 === 0 ? "early_pickup" : "absence_request", g.membershipId, s, at(day, 7, 10, now));
    const approver = await pendingApprover(req.id);
    if (approver) await decide(req.id, approver, "APPROVED", at(day, 9, 30, now));
  }
  {
    const s = nineA[3] ?? nineA[0];
    await submit("activity_registration", s.membershipId, s, at(schoolDay(-2, now), 14, 0, now), { activity: "debate" });
  }
  const teachersList = [...staff.values()].filter((s) => s.roles.includes("teacher"));
  for (let i = 0; i < 3; i++) {
    const t = teachersList[(i * 7) % teachersList.length];
    await submit(i === 2 ? "field_trip_approval" : i === 1 ? "pd_request" : "staff_leave", t.membershipId, null, at(schoolDay(-i, now), 11 + i, 5, now));
  }
  for (let i = 0; i < 5; i++) {
    const t = teachersList[(i * 5 + 3) % teachersList.length];
    const day = schoolDay(-(10 + i * 9), now);
    const req = await submit(i % 2 ? "pd_request" : "staff_leave", t.membershipId, null, at(day, 12, 0, now));
    await decide(req.id, omar, "APPROVED", at(day + 1, 8, 50, now));
  }

  // ------------------------------------------------------------------
  // Tickets: IT, lockers, ID cards, contact updates, maintenance
  // ------------------------------------------------------------------
  const ticketServices = ["it_support", "id_card_replacement", "contact_update", "maintenance_request", "feedback", "transport_request"];
  for (let i = 0; i < 14; i++) {
    const svc = ticketServices[i % ticketServices.length];
    const open = i < 5;
    const day = open ? schoolDay(-(i % 3), now) : schoolDay(-(6 + i * 5), now);
    const staffSvc = svc === "maintenance_request";
    const s = r.pick(w.students.filter((x) => x !== w.adam && x !== w.yara));
    const requester = staffSvc ? r.pick(teachersList).membershipId : svc === "contact_update" || svc === "transport_request" ? guardiansOf(s)[0].membershipId : s.membershipId;
    const req = await submit(svc, requester, staffSvc ? null : s, at(day, 9 + (i % 6), 10, now));
    if (!open) {
      const approver = await pendingApprover(req.id);
      if (approver) await decide(req.id, approver, "APPROVED", at(day + 1, 9, 0, now));
      await completeTasksFor(req.id, at(day + 1, 13, 0, now));
    }
  }

  // ------------------------------------------------------------------
  // Referrals that open cases (academic, behavior, wellbeing, learning support)
  // ------------------------------------------------------------------
  const referralPlan: Array<{ svc: string; grade: number; daysAgo: number; urgency: string; subject?: string; by?: string }> = [
    { svc: "academic_concern", grade: 9, daysAgo: 1, urgency: "medium", subject: "MATH" },
    { svc: "academic_concern", grade: 10, daysAgo: 2, urgency: "high", subject: "CHEM" },
    { svc: "academic_concern", grade: 8, daysAgo: 6, urgency: "medium", subject: "ENG" },
    { svc: "academic_concern", grade: 9, daysAgo: 12, urgency: "low", subject: "PHYS", by: "daniel_carter" },
    { svc: "academic_concern", grade: 11, daysAgo: 9, urgency: "medium", subject: "MATH" },
    { svc: "academic_concern", grade: 7, daysAgo: 21, urgency: "medium", subject: "ARAB" },
    { svc: "behavioral_referral", grade: 8, daysAgo: 4, urgency: "high" },
    { svc: "behavioral_referral", grade: 10, daysAgo: 15, urgency: "medium" },
    { svc: "wellbeing_referral", grade: 10, daysAgo: 8, urgency: "medium" },
    { svc: "learning_support_referral", grade: 7, daysAgo: 13, urgency: "medium", subject: "ENG" },
  ];
  for (const [i, p] of referralPlan.entries()) {
    const pool = grade(p.grade);
    const s = pool[(i * 3) % pool.length];
    const subjectClass = p.subject ? w.classes.find((c) => c.grade === s.grade && c.subject === p.subject) : null;
    const referrer = p.by ? S(p.by).membershipId : subjectClass?.teacherId ?? r.pick(teachersList).membershipId;
    const day = schoolDay(-p.daysAgo, now);
    await submit(p.svc, referrer, s, at(day, 10 + (i % 4), 20, now), {
      student: s.id,
      subject: p.subject,
      urgency: p.urgency,
      concernAreas: ["grades_declining", "missing_homework"],
      observations: "Grades have dropped over the last few weeks and homework is often incomplete. Seems less engaged in class.",
      actionsTaken: "Spoke with the student after class and offered lunchtime help sessions.",
    });
  }
  // Student asks to talk to someone (confidential) yesterday afternoon.
  {
    const s = grade(10)[2];
    await submit("talk_to_someone", s.membershipId, s, at(schoolDay(-1, now), 13, 50, now), { who: "counselor", howUrgent: "this_week" });
  }

  // ------------------------------------------------------------------
  // Career guidance requests with booked sessions
  // ------------------------------------------------------------------
  const careerStudents = [...grade(11).slice(0, 2), ...grade(12).slice(0, 2), grade(10)[5]].filter(Boolean);
  for (const [i, s] of careerStudents.entries()) {
    const day = schoolDay(-(3 + i * 4), now);
    const apptDay = i < 2 ? schoolDay(i + 1, now) : schoolDay(-(1 + i), now);
    const appt = await createAppointment("career_guidance_session", layla, s.membershipId, s, at(apptDay, 9 + i, i % 2 ? 30 : 0, now), i < 2 ? "CONFIRMED" : "COMPLETED");
    await submit("career_guidance", s.membershipId, s, at(day, 16, 0, now), { interests: ["engineering_tech", "business"], careerIdeas: "I am thinking about engineering or business.", shareWithParent: true }, appt);
  }

  // ------------------------------------------------------------------
  // The demo safeguarding case: fictional, low level, non-graphic.
  // ------------------------------------------------------------------
  {
    const s = nineBPhys[2] ?? grade(9)[4];
    const khalid = S("khalid_yousef").membershipId;
    const day = schoolDay(-9, now);
    const req = await submit("safeguarding_concern", daniel, s, at(day, 12, 35, now), {
      student: s.id,
      level: "MEDIUM",
      whatHappened: "Over the last two weeks the student has arrived tired most mornings and has been collected late several times, once after 5pm. Today they said they have been looking after a younger sibling in the evenings. No injuries or distress observed.",
      when: at(day, 12, 0, now).toISOString().slice(0, 10),
      where: "Physics lab, after the lesson",
      childWords: "\"I've been helping at home a lot, I'm just tired.\"",
      othersInformed: [],
      declaration: true,
    });
    const caseId = (await db.request.findUniqueOrThrow({ where: { id: req.id } })).caseId!;
    const theCase = await db.case.findUniqueOrThrow({ where: { id: caseId } });
    const notes: Array<{ days: number; hour: number; kind: "NOTE" | "DECISION" | "CONTACT" | "ACTION"; body: string; amended?: string }> = [
      { days: 0, hour: 14, kind: "ACTION", body: "Concern received. Reviewed with the referring teacher. Low to medium level. No immediate risk identified." },
      { days: 1, hour: 10, kind: "CONTACT", body: "Met the student with the school counselor present. Student confirmed they help care for a younger sibling while a parent works evening shifts. Student feels safe at home." },
      { days: 2, hour: 9, kind: "DECISION", body: "Decision: notify parents and offer family support. Reason recorded in the parent notification log.", amended: "Decision: notify parents and offer family support, including after-school homework club and the school's family liaison. Reason recorded in the parent notification log." },
      { days: 4, hour: 15, kind: "CONTACT", body: "Phone call with the mother. Warm and cooperative. Agreed on collection by 4pm, with a family friend as backup contact. Homework club place offered." },
      { days: 7, hour: 11, kind: "NOTE", body: "Review: attendance and punctuality improved this week. Student reports feeling more rested. Continue light-touch monitoring for three weeks." },
    ];
    for (const n of notes) {
      const when = at(day + n.days, n.hour, 15, now);
      const note = await db.caseNote.create({ data: { orgId, caseId: theCase.id, authorId: khalid, kind: n.kind, currentVersion: n.amended ? 2 : 1, occurredAt: when, createdAt: when } });
      await db.caseNoteVersion.create({ data: { orgId, noteId: note.id, version: 1, body: n.body, editedById: khalid, createdAt: when } });
      if (n.amended) {
        await db.caseNoteVersion.create({ data: { orgId, noteId: note.id, version: 2, body: n.amended, editedById: khalid, reason: "Added the support offered to the family.", createdAt: new Date(when.getTime() + 3600_000) } });
      }
      await db.timelineEvent.create({
        data: { orgId, caseId: theCase.id, studentId: s.id, actorId: khalid, kind: `note_${n.kind.toLowerCase()}`, titleEn: `${n.kind === "DECISION" ? "Decision" : n.kind === "CONTACT" ? "Contact" : n.kind === "ACTION" ? "Action" : "Note"} recorded`, titleAr: n.kind === "DECISION" ? "تم تسجيل قرار" : n.kind === "CONTACT" ? "تم تسجيل تواصل" : n.kind === "ACTION" ? "تم تسجيل إجراء" : "تمت إضافة ملاحظة", sensitivity: "SAFEGUARDING", staffOnly: true, createdAt: when },
      });
    }
    const guardian = guardiansOf(s)[0];
    await db.parentNotificationDecision.create({
      data: { orgId, caseId: theCase.id, decision: "NOTIFY", reason: "Low-level concern about tiredness and late collection. Working openly with the family is in the child's best interest and there is no indication that informing parents would increase risk.", guardianIds: guardian ? [guardian.id] : [], decidedById: khalid, createdAt: at(day + 2, 9, 30, now) },
    });
    await db.caseAccessGrant.create({
      data: { orgId, caseId: theCase.id, membershipId: sarah, grantedById: khalid, reason: "Counselor supporting the student in weekly check-ins.", createdAt: at(day + 1, 9, 0, now), expiresAt: at(day + 45, 0, 0, now) },
    });
    await db.caseParticipant.create({ data: { orgId, caseId: theCase.id, membershipId: sarah, role: "TEAM", createdAt: at(day + 1, 9, 0, now) } });
    await db.case.update({ where: { id: theCase.id }, data: { status: "IN_PROGRESS", nextFollowUpAt: at(schoolDay(5, now), 10, 0, now), titleEn: "Tiredness and late collection", titleAr: "إرهاق وتأخر في الاستلام من المدرسة", retentionUntil: at(365 * 25, 0, 0, now) } });
    const task = await db.task.findFirst({ where: { orgId, caseId: theCase.id } });
    if (task) await db.task.update({ where: { id: task.id }, data: { status: "DONE", completedAt: at(day + 1, 10, 0, now) } });
    await db.task.create({
      data: { orgId, titleEn: "Three-week safeguarding review", titleAr: "مراجعة الحماية بعد ثلاثة أسابيع", status: "TODO", priority: "MEDIUM", dueAt: at(schoolDay(5, now), 10, 0, now), assigneeId: khalid, createdById: khalid, caseId: theCase.id, studentId: s.id, sensitivity: "SAFEGUARDING", href: `/cases/${theCase.id}` },
    });
    await db.auditEvent.createMany({
      data: [
        { orgId, actorId: khalid, action: "case.view", entityType: "Case", entityId: theCase.id, sensitivity: "SAFEGUARDING", createdAt: at(day, 14, 0, now) },
        { orgId, actorId: sarah, action: "case.view", entityType: "Case", entityId: theCase.id, sensitivity: "SAFEGUARDING", reason: "Access granted by DSL", createdAt: at(day + 1, 9, 5, now) },
        { orgId, actorId: khalid, action: "case.parent_notification", entityType: "Case", entityId: theCase.id, sensitivity: "SAFEGUARDING", createdAt: at(day + 2, 9, 30, now) },
        { orgId, actorId: omar, action: "case.view", entityType: "Case", entityId: theCase.id, sensitivity: "SAFEGUARDING", reason: "Principal oversight review", createdAt: at(day + 3, 8, 40, now) },
      ],
    });
  }

  // ------------------------------------------------------------------
  // Case library from stories (older, many resolved) for dashboards and analytics
  // ------------------------------------------------------------------
  const deptKeys = ["mathematics", "science", "english", "arabic_islamic", "humanities", "computing", "student_services"];
  let caseSeq = 900;
  for (const [i, story] of CASE_STORIES.entries()) {
    const g = [6, 7, 8, 9, 10, 11, 12][i % 7];
    const pool = grade(g);
    const s = pool[(i * 5 + 1) % pool.length];
    const assignee = story.type === "CAREER" ? layla : g >= 11 ? S("counselor_second").membershipId : sarah;
    const opened = schoolDay(-(14 + ((i * 7) % 110)), now);
    const resolved = i % 3 !== 0;
    const status = resolved ? (i % 2 ? "CLOSED" : "RESOLVED") : i % 5 === 1 ? "WAITING" : "IN_PROGRESS";
    const referrer = r.pick(teachersList).membershipId;
    const sensitivity: "WELLBEING" | "CONFIDENTIAL" | "STANDARD" = story.type === "WELLBEING" ? "WELLBEING" : story.type === "LEARNING_SUPPORT" ? "CONFIDENTIAL" : "STANDARD";
    const openedAt = at(opened, 10, 0, now);
    const resolvedAt = resolved ? at(opened + 5 + (i % 12), 14, 0, now) : null;
    const caseId = id();
    await db.case.create({
      data: {
        id: caseId,
        orgId,
        number: `CASE-${openedAt.getUTCFullYear()}-${String(caseSeq++).padStart(4, "0")}`,
        type: story.type,
        sensitivity,
        studentId: s.id,
        titleEn: story.title.en,
        titleAr: story.title.ar,
        summaryEn: story.summary.en,
        summaryAr: story.summary.ar,
        assigneeId: assignee,
        referrerId: referrer,
        departmentId: w.departments.get(deptKeys[i % deptKeys.length]) ?? null,
        priority: story.priority,
        status,
        slaDueAt: new Date(openedAt.getTime() + (story.priority === "HIGH" ? 24 : 72) * 3600_000),
        nextFollowUpAt: resolved ? null : at(i % 4 === 0 ? -2 : schoolDay(1 + (i % 6), now), 10, 0, now),
        openedAt,
        resolvedAt,
        closedAt: status === "CLOSED" ? resolvedAt : null,
        createdAt: openedAt,
      },
    });
    await db.caseParticipant.createMany({
      data: [
        { orgId, caseId, membershipId: assignee, role: "ASSIGNEE", createdAt: openedAt },
        { orgId, caseId, membershipId: referrer, role: "REFERRER", createdAt: openedAt },
      ],
    });
    for (const [j, body] of story.notes.entries()) {
      const when = at(opened + j * 2, 11 + j, 0, now);
      const noteId = id();
      await db.caseNote.create({ data: { id: noteId, orgId, caseId, authorId: assignee, kind: j === 0 ? "ACTION" : "NOTE", occurredAt: when, createdAt: when } });
      await db.caseNoteVersion.create({ data: { orgId, noteId, version: 1, body, editedById: assignee, createdAt: when } });
    }
    await db.timelineEvent.createMany({
      data: [
        { orgId, caseId, studentId: s.id, actorId: referrer, kind: "case_opened", titleEn: "Case opened", titleAr: "فُتحت الحالة", sensitivity, staffOnly: true, createdAt: openedAt },
        ...story.notes.map((_, j) => ({ orgId, caseId, studentId: s.id, actorId: assignee, kind: "note", titleEn: "Note added", titleAr: "تمت إضافة ملاحظة", sensitivity, staffOnly: true, createdAt: at(opened + j * 2, 11 + j, 0, now) })),
        ...(resolvedAt ? [{ orgId, caseId, studentId: s.id, actorId: assignee, kind: "resolved", titleEn: "Case resolved", titleAr: "تم حل الحالة", sensitivity, staffOnly: true, createdAt: resolvedAt }] : []),
      ],
    });
    if (!resolved) {
      await db.task.create({
        data: {
          orgId,
          titleEn: TASK_TITLES[i % TASK_TITLES.length].en,
          titleAr: TASK_TITLES[i % TASK_TITLES.length].ar,
          status: "TODO",
          priority: story.priority,
          dueAt: i % 4 === 0 ? at(schoolDay(-2, now), 12, 0, now) : at(schoolDay(i % 5, now), 14, 0, now),
          assigneeId: assignee,
          createdById: assignee,
          caseId,
          studentId: s.id,
          sensitivity,
          href: `/cases/${caseId}`,
          createdAt: openedAt,
        },
      });
    }
    // Some cases have past meetings.
    if (i % 2 === 0) {
      await createAppointment(story.type === "CAREER" ? "career_guidance_session" : "counselor_meeting", assignee, s.membershipId, s, at(opened + 2, 10 + (i % 5), 0, now), "COMPLETED", { caseId });
    }
  }

  // ------------------------------------------------------------------
  // Calendars: today and this week for the personas
  // ------------------------------------------------------------------
  const today = schoolDay(0, now);
  // "Today" meetings start after the current time so dashboards always show what is coming up.
  const dubaiHour = (now.getUTCHours() + 4) % 24 + now.getUTCMinutes() / 60;
  const startH = today === 0 ? Math.max(8, Math.ceil(dubaiHour + 0.75)) : 9;
  const slotAt = (i: number): [number, number, number] => {
    const t = startH + i * 1.5;
    return [today, Math.floor(t), (t % 1) * 60];
  };
  const sarahCases = await db.case.findMany({ where: { orgId, assigneeId: sarah, status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] }, sensitivity: { not: "SAFEGUARDING" } }, take: 6, orderBy: { openedAt: "desc" } });
  const sarahSlots: Array<[number, number, number]> = [
    slotAt(0),
    slotAt(1),
    slotAt(2),
    [today + 1, 10, 0],
    [schoolDay(2, now), 9, 30],
    [schoolDay(3, now), 12, 0],
  ];
  for (const [i, c] of sarahCases.entries()) {
    if (!sarahSlots[i]) break;
    const st = w.studentById.get(c.studentId)!;
    const [d, h, m] = sarahSlots[i];
    await createAppointment("counselor_meeting", sarah, st.membershipId, st, at(d, h, m, now), "CONFIRMED", { caseId: c.id });
  }
  // Daniel has parent meetings this week (booked by parents through the parent meeting service).
  for (let i = 0; i < 3; i++) {
    const s = nineA[4 + i] ?? nineA[i];
    const g = guardiansOf(s)[0];
    const d = schoolDay(i === 0 ? 1 : i + 1, now);
    const appt = await createAppointment("parent_teacher_meeting", daniel, g.membershipId, s, at(d, 14, 30 + (i % 2) * 30, now), "CONFIRMED", { guardianId: g.id });
    await submit("parent_meeting", g.membershipId, s, at(schoolDay(-3 + i, now), 20, 0, now), { student: s.id, topic: i === 1 ? "subject_choice" : "progress", attendance: i === 2 ? "online" : "in_person" }, appt);
  }
  // Past parent meetings with other teachers
  for (let i = 0; i < 16; i++) {
    const s = r.pick(w.students);
    const g = guardiansOf(s)[0];
    const tutor = w.classes.find((c) => c.homeroom && c.grade === s.grade && c.section === s.section)!.teacherId!;
    await createAppointment("parent_teacher_meeting", tutor, g.membershipId, s, at(schoolDay(-(3 + i * 4), now), 14 + (i % 2), (i % 2) * 30, now), i % 9 === 4 ? "NO_SHOW" : "COMPLETED", { guardianId: g.id });
  }
  // Layla's week
  for (let i = 0; i < 4; i++) {
    const s = grade(12)[3 + i] ?? grade(11)[i];
    await createAppointment("career_guidance_session", layla, s.membershipId, s, at(schoolDay(-(6 + i * 3), now), 10, 0, now), "COMPLETED");
  }
  await createAppointment("career_guidance_session", layla, grade(11)[4].membershipId, grade(11)[4], at(...slotAt(1), now), "CONFIRMED");

  // Personal tasks for staff personas (some overdue, some today)
  const personaTasks: Array<[string, number, number]> = [
    [sarah, -1, 0],
    [sarah, 0, 1],
    [sarah, 0, 2],
    [layla, 0, 3],
    [layla, 2, 4],
    [daniel, 0, 5],
    [daniel, -2, 6],
    [aisha, 0, 7],
    [aisha, 1, 8],
    [omar, 3, 9],
    [S("khalid_yousef").membershipId, 1, 10],
  ];
  for (const [assignee, dayOff, ti] of personaTasks) {
    const t = TASK_TITLES[ti % TASK_TITLES.length];
    await db.task.create({
      data: { orgId, titleEn: t.en, titleAr: t.ar, status: "TODO", priority: dayOff < 0 ? "HIGH" : "MEDIUM", dueAt: at(dayOff < 0 ? dayOff : schoolDay(dayOff, now), 15, 0, now), assigneeId: assignee, createdById: assignee, createdAt: at(schoolDay(-5, now), 9, 0, now) },
    });
  }
  // Adam's own task from Layla
  await db.task.create({
    data: { orgId, titleEn: "Take the career aptitude assessment", titleAr: "إكمال اختبار الميول المهنية", descEn: "It takes about 10 minutes. Your results help us plan your subject choices.", descAr: "يستغرق نحو 10 دقائق، وتساعدنا نتائجك في التخطيط لاختيار المواد.", status: "TODO", priority: "MEDIUM", dueAt: at(schoolDay(4, now), 15, 0, now), assigneeId: adam.membershipId, createdById: layla, studentId: adam.id, href: "/career/assessment", createdAt: at(schoolDay(-3, now), 9, 0, now) },
  });
  await db.task.create({
    data: { orgId, titleEn: "Upload a photo for your new ID card", titleAr: "رفع صورة لبطاقتك المدرسية الجديدة", status: "DONE", priority: "LOW", dueAt: at(schoolDay(-10, now), 15, 0, now), assigneeId: adam.membershipId, createdById: aisha, studentId: adam.id, completedAt: at(schoolDay(-11, now), 18, 0, now), createdAt: at(schoolDay(-14, now), 9, 0, now) },
  });

  // ------------------------------------------------------------------
  // Bulk history: completed requests over the last four months (for analytics)
  // ------------------------------------------------------------------
  const bulkServices = ["document_request", "absence_request", "it_support", "activity_registration", "locker_request", "id_card_replacement", "feedback", "transport_request", "early_pickup", "contact_update", "exam_access_arrangements", "recommendation_letter", "counselor_meeting"];
  const reqRows: Prisma.RequestCreateManyInput[] = [];
  const subRows: Prisma.SubmissionCreateManyInput[] = [];
  const tlRows: Prisma.TimelineEventCreateManyInput[] = [];
  const seqCounters = new Map<string, number>();
  for (let i = 0; i < 150; i++) {
    const key = bulkServices[i % bulkServices.length];
    const svc = w.services.get(key)!;
    const s = r.pick(w.students.filter((x) => x !== w.adam && x !== w.yara));
    const parentRequested = ["absence_request", "transport_request", "early_pickup", "contact_update", "document_request"].includes(key);
    const requester = parentRequested ? guardiansOf(s)[0].membershipId : s.membershipId;
    const day = schoolDay(-(12 + Math.floor((i * 97) % 110)), now);
    const submittedAt = at(day, 7 + (i % 10), (i * 13) % 60, now);
    const slaHours = [24, 48, 72][i % 3];
    const late = i % 11 === 3;
    const hoursToComplete = late ? slaHours + 10 + (i % 20) : 2 + ((i * 7) % Math.max(slaHours - 4, 4));
    const completedAt = new Date(submittedAt.getTime() + hoursToComplete * 3600_000);
    const rejected = i % 17 === 5;
    const year = submittedAt.getUTCFullYear();
    const seqKey = `${svc.prefix}-${year}`;
    const n = (seqCounters.get(seqKey) ?? 500) + 1;
    seqCounters.set(seqKey, n);
    const number = `${svc.prefix}-${year}-${String(n).padStart(4, "0")}`;
    const reqId = id();
    const subId = svc.formVersionId ? id() : null;
    const noteTitles = REQUEST_NOTES[key];
    const title = noteTitles ? noteTitles[i % noteTitles.length] : { en: `${svc.nameEn} for ${s.first.en} ${s.last.en}`, ar: `${svc.nameAr} للطالب/ة ${s.first.ar} ${s.last.ar}` };
    if (subId) subRows.push({ id: subId, orgId, formVersionId: svc.formVersionId!, submittedById: requester, studentId: s.id, data: sampleData(svc.schema, s, nameOf(requester), {}, 1000 + i) as never, createdAt: submittedAt });
    reqRows.push({
      id: reqId,
      orgId,
      number,
      serviceId: svc.id,
      requesterId: requester,
      studentId: s.id,
      submissionId: subId,
      status: rejected ? "REJECTED" : "COMPLETED",
      priority: "MEDIUM",
      sensitivity: svc.sensitivity as never,
      titleEn: title.en,
      titleAr: title.ar,
      currentStepEn: rejected ? "Closed as not approved" : "Completed",
      currentStepAr: rejected ? "أُغلق دون موافقة" : "مكتمل",
      progress: 100,
      slaDueAt: new Date(submittedAt.getTime() + slaHours * 3600_000),
      submittedAt,
      completedAt,
      createdAt: submittedAt,
    });
    tlRows.push(
      { orgId, requestId: reqId, studentId: s.id, actorId: requester, kind: "submitted", titleEn: "Request submitted", titleAr: "تم تقديم الطلب", bodyEn: number, bodyAr: number, createdAt: submittedAt },
      { orgId, requestId: reqId, studentId: s.id, kind: "status", titleEn: "In review", titleAr: "قيد المراجعة", createdAt: new Date(submittedAt.getTime() + 60 * 60000) },
      { orgId, requestId: reqId, studentId: s.id, kind: rejected ? "rejected" : "completed", titleEn: rejected ? "Closed as not approved" : "Completed", titleAr: rejected ? "أُغلق دون موافقة" : "مكتمل", createdAt: completedAt },
    );
  }
  for (const [key, value] of seqCounters) {
    await db.sequence.upsert({ where: { orgId_key: { orgId, key } }, create: { orgId, key, value }, update: { value: { increment: value } } });
  }
  await db.submission.createMany({ data: subRows });
  await db.request.createMany({ data: reqRows });
  await db.timelineEvent.createMany({ data: tlRows });

  // ------------------------------------------------------------------
  // Uploaded documents (sample PDFs rendered on demand)
  // ------------------------------------------------------------------
  const docRows: Prisma.DocumentCreateManyInput[] = [];
  const verRows: Prisma.DocumentVersionCreateManyInput[] = [];
  const sampleDocs: Array<{ cat: string; en: string; ar: string; sens: "STANDARD" | "CONFIDENTIAL" | "MEDICAL"; family: boolean; expires?: number }> = [
    { cat: "identity", en: "Passport copy", ar: "نسخة جواز السفر", sens: "CONFIDENTIAL", family: false, expires: 400 },
    { cat: "identity", en: "Emirates ID copy", ar: "نسخة الهوية الإماراتية", sens: "CONFIDENTIAL", family: false, expires: 20 },
    { cat: "reports", en: "Term report, last year", ar: "تقرير الفصل، العام الماضي", sens: "STANDARD", family: true },
    { cat: "medical", en: "Vaccination record", ar: "سجل التطعيمات", sens: "MEDICAL", family: false },
    { cat: "consent", en: "Photo and media consent", ar: "موافقة التصوير والنشر", sens: "STANDARD", family: true },
  ];
  for (const s of [w.adam, w.yara, ...w.students.slice(2, 30)]) {
    for (const [j, d] of sampleDocs.entries()) {
      if (s !== w.adam && s !== w.yara && (j + s.grade) % 2 === 1) continue;
      const docId = id();
      const verId = id();
      const created = at(-(40 + j * 20), 10, 0, now);
      docRows.push({ id: docId, orgId, categoryId: w.categories.get(d.cat) ?? null, titleEn: d.en, titleAr: d.ar, studentId: s.id, sensitivity: d.sens, source: "UPLOAD", currentVersionId: verId, expiresAt: d.expires ? at(d.expires, 0, 0, now) : null, uploadedById: aisha, visibleToFamily: d.family, createdAt: created });
      verRows.push({ id: verId, orgId, documentId: docId, version: 1, storageKey: `sample:${d.cat}`, fileName: `${d.en.toLowerCase().replace(/[^a-z]+/g, "-")}.pdf`, mimeType: "application/pdf", sizeBytes: 180_000 + j * 20_000, createdById: aisha, createdAt: created });
    }
  }
  await db.document.createMany({ data: docRows });
  await db.documentVersion.createMany({ data: verRows });

  // Advance any wait steps whose time has passed (for example old two-week follow-ups).
  const waitingRuns = await db.workflowRun.findMany({ where: { orgId, status: "WAITING" }, select: { id: true } });
  for (const run of waitingRuns) await advanceRun(ec(now), run.id);

  // Mark older notifications as read so the bell shows only recent items.
  await db.notification.updateMany({ where: { orgId, createdAt: { lt: at(-3, 0, 0, now) } }, data: { readAt: now } });

  w.log("history ready");

  async function createAppointment(
    typeKey: string,
    hostId: string,
    bookedById: string,
    s: SeedStudent,
    startsAt: Date,
    status: "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW",
    extra: { caseId?: string; guardianId?: string } = {},
  ) {
    const t = w.appointmentTypes.get(typeKey)!;
    const apptId = id();
    await db.appointment.create({
      data: {
        id: apptId,
        orgId,
        typeId: t.id,
        hostId,
        bookedById,
        studentId: s.id,
        guardianId: extra.guardianId ?? null,
        caseId: extra.caseId ?? null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + t.durationMin * 60000),
        status,
        locationEn: t.locationEn,
        locationAr: t.locationAr,
        createdAt: new Date(startsAt.getTime() - 3 * 86400_000),
      },
    });
    await db.appointmentAttendee.createMany({
      data: [
        { orgId, appointmentId: apptId, membershipId: hostId },
        { orgId, appointmentId: apptId, membershipId: bookedById, studentId: s.id, guardianId: extra.guardianId ?? null },
      ],
    });
    return apptId;
  }
}

export type { Bi };
