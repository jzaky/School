// Grades visibility against real Postgres through the RLS-restricted app role:
// families see only published grades of their own children; teachers see only their classes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import type { Permission } from "@/server/identity/permissions";
import { familyGrades, gradebookClasses, loadGradebook, staffOverview, type GradeViewer } from "@/server/grades/queries";
import { saveGrades, setPublished } from "@/server/grades/service";
import { canCreateReportCard } from "@/server/grades/report-card";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let orgId: string;
const ids: Record<string, string> = {};

async function member(name: string) {
  const user = await owner.user.create({ data: { email: `${uid(name)}@itest.example`, nameEn: name } });
  const m = await owner.membership.create({ data: { orgId, userId: user.id } });
  return m.id;
}

function viewer(membershipId: string, roles: string[], perms: Permission[], family: string[] = []): GradeViewer {
  return {
    db: tenantDb(orgId),
    orgId,
    membershipId,
    roles,
    isStudent: roles.includes("student"),
    isParent: roles.includes("parent"),
    can: (p) => perms.includes(p),
    familyStudentIds: family,
  };
}

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("grades-itest"), nameEn: "Grades Test School", nameAr: "مدرسة اختبار الدرجات" } });
  orgId = org.id;
  const now = new Date();
  const year = await owner.academicYear.create({ data: { orgId, nameEn: "Year", nameAr: "العام", startsOn: new Date(now.getTime() - 90 * 86400000), endsOn: new Date(now.getTime() + 200 * 86400000), isCurrent: true } });
  const term = await owner.term.create({ data: { orgId, academicYearId: year.id, nameEn: "Term", nameAr: "الفصل", startsOn: new Date(now.getTime() - 90 * 86400000), endsOn: new Date(now.getTime() + 30 * 86400000) } });
  ids.term = term.id;
  ids.teacherA = await member("Teacher A");
  ids.teacherB = await member("Teacher B");
  ids.studentMember = await member("Student One");
  ids.parentMember = await member("Parent One");
  const dept = await owner.department.create({ data: { orgId, key: "maths", nameEn: "Maths", nameAr: "الرياضيات" } });
  const subject = await owner.subject.create({ data: { orgId, code: "MATH", nameEn: "Maths", nameAr: "الرياضيات", departmentId: dept.id } });
  const classA = await owner.schoolClass.create({ data: { orgId, academicYearId: year.id, subjectId: subject.id, teacherMembershipId: ids.teacherA, nameEn: "Maths 9", nameAr: "الرياضيات 9", gradeLevel: 9 } });
  const classB = await owner.schoolClass.create({ data: { orgId, academicYearId: year.id, subjectId: subject.id, teacherMembershipId: ids.teacherB, nameEn: "Maths 10", nameAr: "الرياضيات 10", gradeLevel: 10 } });
  ids.classA = classA.id;
  ids.classB = classB.id;
  const s1 = await owner.student.create({ data: { orgId, membershipId: ids.studentMember, studentNo: "G-1", firstNameEn: "Sami", lastNameEn: "One", firstNameAr: "سامي", lastNameAr: "واحد", gradeLevel: 9 } });
  const s2 = await owner.student.create({ data: { orgId, studentNo: "G-2", firstNameEn: "Other", lastNameEn: "Two", firstNameAr: "آخر", lastNameAr: "اثنان", gradeLevel: 9 } });
  ids.s1 = s1.id;
  ids.s2 = s2.id;
  const guardian = await owner.guardian.create({ data: { orgId, membershipId: ids.parentMember, firstNameEn: "Parent", lastNameEn: "One", firstNameAr: "ولي", lastNameAr: "أمر", email: `${uid("p")}@itest.example` } });
  await owner.guardianLink.create({ data: { orgId, guardianId: guardian.id, studentId: s1.id } });
  await owner.enrollment.createMany({ data: [{ orgId, studentId: s1.id, classId: classA.id }, { orgId, studentId: s2.id, classId: classA.id }] });
  const pub = await owner.assessment.create({ data: { orgId, classId: classA.id, termId: term.id, titleEn: "Published quiz", titleAr: "اختبار منشور", maxScore: 10, weight: 1, dueAt: new Date(now.getTime() - 5 * 86400000), publishedAt: new Date(now.getTime() - 86400000), createdById: ids.teacherA } });
  const draft = await owner.assessment.create({ data: { orgId, classId: classA.id, termId: term.id, titleEn: "Draft test", titleAr: "اختبار مسودة", maxScore: 50, weight: 2, dueAt: new Date(now.getTime() - 2 * 86400000), createdById: ids.teacherA } });
  ids.pub = pub.id;
  ids.draft = draft.id;
  await owner.grade.createMany({
    data: [
      { orgId, assessmentId: pub.id, studentId: s1.id, score: 8 },
      { orgId, assessmentId: pub.id, studentId: s2.id, score: 3 },
      { orgId, assessmentId: draft.id, studentId: s1.id, score: 10 },
    ],
  });
});

afterAll(async () => {
  if (orgId) {
    const members = await owner.membership.findMany({ where: { orgId }, select: { userId: true } });
    await owner.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    for (const t of ["grade", "assessment", "enrollment", "guardianLink", "guardian", "student", "schoolClass", "subject", "department", "term", "academicYear", "notification", "outboundMessage", "messageTemplate", "auditEvent", "membership"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (owner[t] as any).deleteMany({ where: { orgId } }).catch(() => undefined);
    }
    await owner.organization.deleteMany({ where: { id: orgId } });
    await owner.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await owner.$disconnect();
});

describe("family grade visibility", () => {
  it("a student sees only published grades and only their own score", async () => {
    const v = viewer(ids.studentMember, ["student"], ["grades.view_own"], [ids.s1]);
    const data = await familyGrades(v, ids.s1, ids.term);
    expect(data).not.toBeNull();
    const all = data!.subjects.flatMap((s) => s.assessments);
    expect(all.map((a) => a.id)).toEqual([ids.pub]);
    expect(all[0].score).toBe(8);
    expect(data!.subjects[0].average).toBeCloseTo(80);
    // The unpublished draft (score 10 of 50) must not affect the average either.
    expect(data!.overall).toBeCloseTo(80);
  });

  it("a student cannot read another student's grades", async () => {
    const v = viewer(ids.studentMember, ["student"], ["grades.view_own"], [ids.s1]);
    expect(await familyGrades(v, ids.s2, ids.term)).toBeNull();
  });

  it("a parent sees their own child's published grades and not other children", async () => {
    const v = viewer(ids.parentMember, ["parent"], ["grades.view_own"], [ids.s1]);
    const mine = await familyGrades(v, ids.s1, ids.term);
    expect(mine!.subjects.flatMap((s) => s.assessments).map((a) => a.id)).toEqual([ids.pub]);
    expect(await familyGrades(v, ids.s2, ids.term)).toBeNull();
    expect(await canCreateReportCard(v, ids.s2, ids.term)).toBe(false);
    expect(await canCreateReportCard(v, ids.s1, ids.term)).toBe(true);
  });

  it("families never reach staff views", async () => {
    const v = viewer(ids.parentMember, ["parent"], ["grades.view_own"], [ids.s1]);
    expect(await gradebookClasses(v)).toEqual([]);
    expect(await loadGradebook(v, ids.classA)).toBeNull();
    expect(await staffOverview(v, 60)).toBeNull();
  });
});

describe("teacher scope", () => {
  it("a teacher sees and edits only their own classes", async () => {
    const a = viewer(ids.teacherA, ["teacher"], ["grades.enter"]);
    const b = viewer(ids.teacherB, ["teacher"], ["grades.enter"]);
    expect((await gradebookClasses(a)).map((c) => c.id)).toEqual([ids.classA]);
    expect((await gradebookClasses(b)).map((c) => c.id)).toEqual([ids.classB]);
    expect(await loadGradebook(b, ids.classA)).toBeNull();
    const res = await saveGrades(b, ids.classA, [{ assessmentId: ids.pub, studentId: ids.s1, score: 1 }], "en");
    expect(res.ok).toBe(false);
    const pub = await setPublished(b, ids.draft, true);
    expect(pub.ok).toBe(false);
  });

  it("rejects scores above the maximum", async () => {
    const a = viewer(ids.teacherA, ["teacher"], ["grades.enter"]);
    const res = await saveGrades(a, ids.classA, [{ assessmentId: ids.pub, studentId: ids.s2, score: 11 }, { assessmentId: ids.pub, studentId: ids.s2, score: 4 }], "en");
    expect(res.ok && res.saved).toBe(1);
    expect(res.ok && res.rejected[0].error).toBe("range");
  });

  it("publishing notifies each student and guardian once, even when published again", async () => {
    const a = viewer(ids.teacherA, ["teacher"], ["grades.enter"]);
    const first = await setPublished(a, ids.draft, true);
    expect(first.ok).toBe(true);
    await setPublished(a, ids.draft, false);
    await setPublished(a, ids.draft, true);
    const notes = await owner.notification.findMany({ where: { orgId, kind: "grade_published" } });
    // s1 (student member + parent) and s2 (no member, no guardian): two notifications in total.
    expect(notes.length).toBe(2);
    expect(new Set(notes.map((n) => n.recipientId))).toEqual(new Set([ids.studentMember, ids.parentMember]));
    const v = viewer(ids.studentMember, ["student"], ["grades.view_own"], [ids.s1]);
    const data = await familyGrades(v, ids.s1, ids.term);
    expect(data!.subjects.flatMap((s) => s.assessments).map((x) => x.id).sort()).toEqual([ids.pub, ids.draft].sort());
  });
});
