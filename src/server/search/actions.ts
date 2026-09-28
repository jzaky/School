"use server";

import { getCtx } from "@/server/context";
import { personName, pick } from "@/lib/i18n-data";
import { visibleStudentIds } from "@/server/access/student-access";
import { listableCaseWhere } from "@/server/access/case-access";

export type SearchHit = { kind: "student" | "request" | "case" | "service"; id: string; title: string; subtitle: string; href: string };

/** Global search. Wellbeing and safeguarding cases never appear here (rule 6). */
export async function searchAction(q: string): Promise<SearchHit[]> {
  const ctx = await getCtx();
  const term = q.trim();
  if (term.length < 2) return [];
  const { db, orgId, locale } = ctx;
  const hits: SearchHit[] = [];
  const contains = { contains: term, mode: "insensitive" as const };

  const services = await db.serviceDefinition.findMany({
    where: { orgId, isActive: true, audience: { hasSome: ctx.roles }, OR: [{ nameEn: contains }, { nameAr: contains }] },
    take: 5,
  });
  for (const s of services) hits.push({ kind: "service", id: s.id, title: pick(locale, s.nameEn, s.nameAr), subtitle: "", href: `/services/${s.key}` });

  const allowedStudents = await visibleStudentIds(ctx);
  const studentWhere = {
    orgId,
    ...(allowedStudents ? { id: { in: allowedStudents } } : {}),
    OR: [{ firstNameEn: contains }, { lastNameEn: contains }, { firstNameAr: contains }, { lastNameAr: contains }, { studentNo: contains }],
  };
  if (ctx.isStaff && ctx.can("people.view")) {
    const students = await db.student.findMany({ where: studentWhere, take: 6, orderBy: { firstNameEn: "asc" } });
    for (const s of students)
      hits.push({ kind: "student", id: s.id, title: personName(s, locale), subtitle: `${s.studentNo} · ${s.gradeLevel}${s.section ?? ""}`, href: `/students/${s.id}` });
  }

  const requestWhere = {
    orgId,
    sensitivity: { notIn: ["WELLBEING", "SAFEGUARDING"] as never },
    OR: [{ number: contains }, { titleEn: contains }, { titleAr: contains }],
    ...(ctx.can("requests.view_all") ? {} : { requesterId: ctx.membershipId }),
  };
  const requests = await db.request.findMany({ where: requestWhere, take: 5, orderBy: { submittedAt: "desc" } });
  for (const r of requests) hits.push({ kind: "request", id: r.id, title: r.number, subtitle: pick(locale, r.titleEn, r.titleAr), href: `/requests/${r.id}` });

  if (ctx.isStaff && ctx.can("cases.view")) {
    const cases = await db.case.findMany({
      where: { AND: [listableCaseWhere(ctx, "search"), { OR: [{ number: contains }, { titleEn: contains }, { titleAr: contains }] }] },
      take: 5,
      include: { student: true },
    });
    for (const c of cases) hits.push({ kind: "case", id: c.id, title: c.number, subtitle: `${pick(locale, c.titleEn, c.titleAr)} · ${personName(c.student, locale)}`, href: `/cases/${c.id}` });
  }
  return hits;
}
