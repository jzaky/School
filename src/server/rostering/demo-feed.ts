// The demo school's roster feed. The demo has no real ClassLink district, so its connection (address demo://)
// reads a OneRoster feed built from the school's own records, with a few deliberate differences so a preview has
// something to show: three new students (KG1, KG2 and Grade 9) with a new parent, a student whose family name
// changed, a student who left, a Transitional Kindergarten code the school has not mapped, and a teacher whose
// email changed in the source system. Only demo schools can use it (checked in connections.ts).
// The seed (prisma/seed/rostering.ts) links the unchanged records, so applying the preview converges.
// After the seed, the feed lists only records it already knows (its links) plus those differences: people, classes
// and enrollments made in Horizon during a demo (an invited teacher, a parent who joined, a subject change) are
// Horizon's own and never show up as feed changes.
// No "server-only" marker: the seed imports it.
import { oneRosterClass, oneRosterEnrollment, oneRosterOrg, oneRosterUser, type Staged } from "@/lib/rostering/records";

type Db = {
  student: { findMany: (args: object) => Promise<Array<{ id: string; studentNo: string; firstNameEn: string; lastNameEn: string; gradeLevel: number; guardians: Array<{ guardianId: string }> }>> };
  guardian: { findMany: (args: object) => Promise<Array<{ id: string; firstNameEn: string; lastNameEn: string; email: string | null; phone: string | null; links: Array<{ studentId: string }> }>> };
  membership: { findMany: (args: object) => Promise<Array<{ id: string; user: { email: string; nameEn: string }; staffProfile: { employeeNo: string | null } | null; roles: Array<{ role: { key: string } }> }>> };
  schoolClass: { findMany: (args: object) => Promise<Array<{ id: string; nameEn: string; gradeLevel: number; isHomeroom: boolean; room: string | null; teacherMembershipId: string | null; subject: { code: string; nameEn: string } | null; enrollments: Array<{ id: string; studentId: string }> }>> };
  academicYear: { findFirst: (args: object) => Promise<{ id: string } | null> };
};

export const DEMO_SCHOOL_SOURCED_ID = "demo-org-horizon";
export const DEMO_LEAVER_NO = "HIS-25990";
export const DEMO_RENAMED_NO = "HIS-25991";
export const isDemoFeed = (baseUrl: string | null | undefined) => !!baseUrl && baseUrl.startsWith("demo://");

const code = (level: number) => (level === -1 ? "PK" : level === 0 ? "KG" : String(level).padStart(2, "0"));
const ref = (sourcedId: string) => ({ sourcedId });
const org = [ref(DEMO_SCHOOL_SOURCED_ID)];
export const extOf = {
  student: (id: string) => `demo-stu-${id}`,
  staff: (id: string) => `demo-stf-${id}`,
  guardian: (id: string) => `demo-par-${id}`,
  class: (id: string) => `demo-cls-${id}`,
  enrollment: (id: string) => `demo-enr-${id}`,
  teacher: (classId: string) => `demo-tch-${classId}`,
};

export type DemoFeed = {
  /** What the feed says today. */
  records: Staged[];
  /** The same feed before the deliberate differences (the seed links these, so only the differences show). */
  baseline: Staged[];
  /** Feed id to local id for the baseline records (students, staff, parents, classes, enrollments). */
  local: Map<string, { kind: string; localId: string }>;
};

export async function buildDemoFeed(db: Db, orgId: string, known?: Set<string>): Promise<DemoFeed> {
  const isKnown = (ext: string) => !known || known.has(ext);
  const year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } });
  const [students, guardians, staff, classes] = await Promise.all([
    db.student.findMany({ where: { orgId, status: "ACTIVE", anonymisedAt: null }, orderBy: { studentNo: "asc" }, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, gradeLevel: true, guardians: { select: { guardianId: true } } } }),
    db.guardian.findMany({ where: { orgId, anonymisedAt: null }, orderBy: { id: "asc" }, select: { id: true, firstNameEn: true, lastNameEn: true, email: true, phone: true, links: { select: { studentId: true } } } }),
    db.membership.findMany({ where: { orgId, status: { in: ["ACTIVE", "INVITED"] }, staffProfile: { isNot: null }, student: { is: null }, guardian: { is: null } }, orderBy: { id: "asc" }, select: { id: true, user: { select: { email: true, nameEn: true } }, staffProfile: { select: { employeeNo: true } }, roles: { select: { role: { select: { key: true } } } } } }),
    year ? db.schoolClass.findMany({ where: { orgId, academicYearId: year.id }, orderBy: { id: "asc" }, select: { id: true, nameEn: true, gradeLevel: true, isHomeroom: true, room: true, teacherMembershipId: true, subject: { select: { code: true, nameEn: true } }, enrollments: { where: { status: "ACTIVE" }, select: { id: true, studentId: true } } } }) : Promise.resolve([]),
  ]);
  // Records the feed itself added earlier (after an applied preview) are represented by its own records below.
  const FRESH_NUMBERS = ["HIS-26011", "HIS-26012", "HIS-26013", "HIS-26014"];
  const FRESH_EMAILS = ["huda.darwish@family.horizon.example"];
  const kept = students.filter((s) => !FRESH_NUMBERS.includes(s.studentNo) && isKnown(extOf.student(s.id)));
  const studentIds = new Set(kept.map((s) => s.id));
  // Two students the seed adds for this story only (prisma/seed/rostering.ts), so no other demo flow changes:
  // one whose family name changed in the source system, and one who left the school (active or not by now).
  const renamedId = kept.find((s) => s.studentNo === DEMO_RENAMED_NO)?.id ?? null;
  const leaver = (await db.student.findMany({ where: { orgId, studentNo: DEMO_LEAVER_NO }, take: 1, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, gradeLevel: true, guardians: { select: { guardianId: true } } } }))[0] ?? null;
  const local = new Map<string, { kind: string; localId: string }>();
  const baseline: Staged[] = [];
  const push = (list: Staged[], s: Staged | null) => s && list.push(s);

  // Parents the feed lists: linked to at least one listed student (the new family is added below).
  const listedGuardians = guardians.filter((g) => !(g.email && FRESH_EMAILS.includes(g.email.toLowerCase())) && isKnown(extOf.guardian(g.id)) && g.links.some((l) => studentIds.has(l.studentId)));
  const guardianIds = new Set(listedGuardians.map((g) => g.id));

  push(baseline, oneRosterOrg({ sourcedId: DEMO_SCHOOL_SOURCED_ID, status: "active", name: "Horizon International School Dubai", type: "school", identifier: "HIS" }));
  for (const m of staff) {
    const keys = m.roles.map((r) => r.role.key);
    const [given, ...rest] = m.user.nameEn.split(" ");
    const ext = extOf.staff(m.id);
    if (!isKnown(ext)) continue;
    local.set(ext, { kind: "staff", localId: m.id });
    push(baseline, oneRosterUser({ sourcedId: ext, status: "active", role: keys.includes("teacher") ? "teacher" : "administrator", givenName: given, familyName: rest.join(" "), email: m.user.email, identifier: m.staffProfile?.employeeNo ?? null, orgs: org, agents: [] }));
  }
  for (const s of kept) {
    const ext = extOf.student(s.id);
    local.set(ext, { kind: "student", localId: s.id });
    push(baseline, oneRosterUser({ sourcedId: ext, status: "active", role: "student", givenName: s.firstNameEn, familyName: s.lastNameEn, identifier: s.studentNo, grades: [code(s.gradeLevel)], orgs: org, agents: s.guardians.filter((g) => guardianIds.has(g.guardianId)).map((g) => ref(extOf.guardian(g.guardianId))) }));
  }
  for (const g of listedGuardians) {
    const kids = g.links.map((l) => l.studentId).filter((id) => studentIds.has(id));
    const ext = extOf.guardian(g.id);
    local.set(ext, { kind: "guardian", localId: g.id });
    push(baseline, oneRosterUser({ sourcedId: ext, status: "active", role: "parent", givenName: g.firstNameEn, familyName: g.lastNameEn, email: g.email, phone: g.phone, orgs: org, agents: kids.map((k) => ref(extOf.student(k))) }));
  }
  for (const c of classes) {
    const ext = extOf.class(c.id);
    if (!isKnown(ext)) continue;
    local.set(ext, { kind: "class", localId: c.id });
    push(baseline, oneRosterClass({ sourcedId: ext, status: "active", title: c.nameEn, classType: c.isHomeroom ? "homeroom" : "scheduled", grades: [code(c.gradeLevel)], subjects: c.subject ? [c.subject.nameEn] : [], subjectCodes: c.subject ? [c.subject.code] : [], location: c.room, school: ref(DEMO_SCHOOL_SOURCED_ID) }));
    for (const e of c.enrollments) {
      if (!studentIds.has(e.studentId)) continue;
      const eext = extOf.enrollment(e.id);
      if (!isKnown(eext)) continue;
      local.set(eext, { kind: "enrollment", localId: e.id });
      push(baseline, oneRosterEnrollment({ sourcedId: eext, status: "active", user: ref(extOf.student(e.studentId)), class: ref(ext), role: "student" }));
    }
    if (c.teacherMembershipId && staff.some((m) => m.id === c.teacherMembershipId) && isKnown(extOf.staff(c.teacherMembershipId)) && isKnown(extOf.teacher(c.id))) {
      const text = extOf.teacher(c.id);
      local.set(text, { kind: "enrollment", localId: `teacher:${c.id}:${c.teacherMembershipId}` });
      push(baseline, oneRosterEnrollment({ sourcedId: text, status: "active", user: ref(extOf.staff(c.teacherMembershipId)), class: ref(ext), role: "teacher", primary: true }));
    }
  }

  // Today's feed: the baseline with the deliberate differences.
  const leftExt = leaver ? extOf.student(leaver.id) : null;
  const renamedExt = renamedId ? extOf.student(renamedId) : null;
  const teacher = baseline.find((r) => r.kind === "user" && (r.data as { role: string }).role === "teacher" && (r.data as { email: string | null }).email);
  const out: Staged[] = [];
  for (const r of baseline) {
    if (leftExt && (r.externalId === leftExt || (r.kind === "enrollment" && (r.data as { userId: string }).userId === leftExt))) continue;
    if (renamedExt && r.externalId === renamedExt) {
      const d = r.data as { familyName: string };
      push(out, oneRosterUser({ ...toRow(r), familyName: d.familyName.endsWith(" Al Hashimi") ? d.familyName : `${d.familyName} Al Hashimi` }));
      continue;
    }
    if (teacher && r.externalId === teacher.externalId) {
      const d = r.data as { email: string };
      push(out, oneRosterUser({ ...toRow(r), email: d.email.replace("@", ".staff@") }));
      continue;
    }
    out.push(r);
  }
  const grade9 = out.find((r) => r.kind === "class" && (r.data as { grades: string[]; homeroom: boolean }).grades[0] === "09" && (r.data as { homeroom: boolean }).homeroom) ?? out.find((r) => r.kind === "class" && (r.data as { grades: string[] }).grades[0] === "09");
  const fresh: Array<Record<string, unknown>> = [
    { sourcedId: "demo-new-p1", status: "active", role: "parent", givenName: "Huda", familyName: "Darwish", email: "huda.darwish@family.horizon.example", orgs: org, agents: [ref("demo-new-1"), ref("demo-new-2")] },
    { sourcedId: "demo-new-1", status: "active", role: "student", givenName: "Lina", familyName: "Darwish", identifier: "HIS-26011", grades: ["PK"], orgs: org, agents: [ref("demo-new-p1")] },
    { sourcedId: "demo-new-2", status: "active", role: "student", givenName: "Omar", familyName: "Darwish", identifier: "HIS-26012", grades: ["KG"], orgs: org, agents: [ref("demo-new-p1")] },
    { sourcedId: "demo-new-3", status: "active", role: "student", givenName: "Zayd", familyName: "Khalil", identifier: "HIS-26013", grades: ["09"], orgs: org, agents: [] },
    { sourcedId: "demo-new-4", status: "active", role: "student", givenName: "Maya", familyName: "Saleh", identifier: "HIS-26014", grades: ["TK"], orgs: org, agents: [] },
  ];
  for (const f of fresh) push(out, oneRosterUser(f));
  if (grade9) push(out, oneRosterEnrollment({ sourcedId: "demo-new-enr-3", status: "active", user: ref("demo-new-3"), class: ref(grade9.externalId), role: "student" }));
  return { records: out, baseline, local };
}

/** A staged user back to the OneRoster row shape, to change one field. */
function toRow(r: Staged): Record<string, unknown> {
  const d = r.data as { id: string; status: string; role: string | null; givenName: string; familyName: string; email: string | null; identifier: string | null; grades: string[]; orgIds: string[]; agentIds: string[]; phone: string | null };
  return { sourcedId: d.id, status: d.status, role: d.role, givenName: d.givenName, familyName: d.familyName, email: d.email, identifier: d.identifier, grades: d.grades, orgs: d.orgIds.map(ref), agents: d.agentIds.map(ref), phone: d.phone };
}
