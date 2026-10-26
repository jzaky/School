"use server";
// Server-side search for pickers, so a picker never loads a whole school (1,500 students, 2,500 guardians) into
// the page. Each call returns at most SEARCH_LIMIT matches; the picker asks again as the person types.
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { getCtx } from "@/server/context";
import { personName } from "@/lib/i18n-data";
import { gradeLabel, isGradeLevel } from "@/lib/grade-levels";
import { searchTerm } from "@/server/common/paging";
import { studentSearchWhere } from "@/server/students/grade-options";
import { visibleStudentIds } from "@/server/access/student-access";

export type PickHit = { value: string; label: string; hint?: string };

const SEARCH_LIMIT = 20;

export type StudentSearch = {
  q: string;
  /** Lowest grade to include (pathways and university pages are Grade 9 and above). */
  minGrade?: number | null;
  /** Only students without a portal account (invitations). */
  withoutAccount?: boolean;
  /** Include students who left (status other than ACTIVE). */
  anyStatus?: boolean;
};

/** Students the member may see, matching every word typed (names in English or Arabic, or student number). */
export async function searchStudentsAction(input: StudentSearch): Promise<PickHit[]> {
  const ctx = await getCtx();
  const ids = await visibleStudentIds(ctx);
  if (ids !== null && !ids.length) return [];
  const q = searchTerm(input.q);
  const where: Prisma.StudentWhereInput = {
    ...(input.anyStatus ? {} : { status: "ACTIVE" }),
    ...(ids ? { id: { in: ids } } : {}),
    ...(isGradeLevel(input.minGrade) ? { gradeLevel: { gte: input.minGrade } } : {}),
    ...(input.withoutAccount ? { membershipId: null } : {}),
    ...(q ? studentSearchWhere(q) : {}),
  };
  const rows = await ctx.db.student.findMany({
    where,
    select: { id: true, studentNo: true, gradeLevel: true, section: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true },
    orderBy: [{ lastNameEn: "asc" }, { firstNameEn: "asc" }, { id: "asc" }],
    take: SEARCH_LIMIT,
  });
  const tg = await getTranslations("gradeLevel");
  return rows.map((s) => ({ value: s.id, label: personName(s, ctx.locale), hint: `${s.studentNo} · ${gradeLabel(tg, s.gradeLevel, s.section, { short: true })}` }));
}

/** Guardians (for linking a new student to an existing family). Staff who manage people only. */
export async function searchGuardiansAction(input: { q: string }): Promise<PickHit[]> {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("people.manage")) return [];
  const q = searchTerm(input.q);
  const words = q.split(" ").filter(Boolean).slice(0, 5);
  const rows = await ctx.db.guardian.findMany({
    where: words.length
      ? {
          AND: words.map((w) => ({
            OR: [
              { firstNameEn: { contains: w, mode: "insensitive" as const } },
              { lastNameEn: { contains: w, mode: "insensitive" as const } },
              { firstNameAr: { contains: w } },
              { lastNameAr: { contains: w } },
              { email: { contains: w, mode: "insensitive" as const } },
              { phone: { contains: w } },
            ],
          })),
        }
      : {},
    orderBy: [{ lastNameEn: "asc" }, { firstNameEn: "asc" }, { id: "asc" }],
    take: SEARCH_LIMIT,
  });
  return rows.map((g) => ({ value: g.id, label: personName(g, ctx.locale), hint: g.email ?? undefined }));
}

/** Anyone with a membership (staff, parents, students), for the access check. People who manage roles only. */
export async function searchMembersAction(input: { q: string }): Promise<PickHit[]> {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("roles.manage")) return [];
  const words = searchTerm(input.q).split(" ").filter(Boolean).slice(0, 5);
  const now = new Date();
  const rows = await ctx.db.membership.findMany({
    where: {
      status: { in: ["ACTIVE", "SUSPENDED", "INVITED"] },
      roles: { some: {} },
      ...(words.length ? { AND: words.map((w) => ({ user: { OR: [{ nameEn: { contains: w, mode: "insensitive" as const } }, { nameAr: { contains: w } }, { email: { contains: w, mode: "insensitive" as const } }] } })) } : {}),
    },
    include: { user: { select: { nameEn: true, nameAr: true, email: true } }, roles: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, include: { role: { select: { nameEn: true, nameAr: true } } } } },
    orderBy: [{ user: { nameEn: "asc" } }, { id: "asc" }],
    take: SEARCH_LIMIT,
  });
  return rows.map((m) => ({ value: m.id, label: ctx.locale === "ar" && m.user.nameAr ? m.user.nameAr : m.user.nameEn, hint: m.roles.map((r) => (ctx.locale === "ar" ? r.role.nameAr : r.role.nameEn)).join(", ") }));
}
