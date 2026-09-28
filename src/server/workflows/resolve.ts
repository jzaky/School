// Resolve workflow assignees (roles, requester, guardians, class teacher...) to memberships.
import type { ExecCtx } from "@/server/db";
import type { Assignee } from "./graph";

export type RunContext = {
  form: Record<string, unknown>;
  request: { id: string; number: string; hasStudent: boolean; priority: string; serviceKey: string; requesterId: string; sensitivity: string };
  student: { id: string; grade: number; membershipId: string | null } | null;
  caseId?: string | null;
  caseAssigneeId?: string | null;
  appointmentId?: string | null;
  appointmentHostId?: string | null;
  documentId?: string | null;
};

export type ResolvedAssignee = { membershipId: string | null; guardianId?: string | null };

async function membersWithRole(ec: ExecCtx, role: string) {
  const rows = await ec.tx.membershipRole.findMany({
    where: { orgId: ec.orgId, role: { key: role }, membership: { status: "ACTIVE" } },
    select: { membershipId: true, membership: { select: { createdAt: true, staffProfile: { select: { gradeLevels: true } } } } },
    orderBy: { membership: { createdAt: "asc" } },
  });
  return rows.map((r) => ({ membershipId: r.membershipId, gradeLevels: r.membership.staffProfile?.gradeLevels ?? [] }));
}

/** Find the subject a form field points at. Accepts a subject id or code. */
async function subjectFrom(ec: ExecCtx, value: unknown) {
  if (!value || typeof value !== "string") return null;
  return ec.tx.subject.findFirst({
    where: { orgId: ec.orgId, OR: [{ id: value }, { code: value.toUpperCase() }] },
    include: { department: true },
  });
}

export async function resolveAssignee(ec: ExecCtx, a: Assignee, ctx: RunContext): Promise<ResolvedAssignee[]> {
  const { tx, orgId } = ec;
  switch (a.kind) {
    case "member":
      return [{ membershipId: a.membershipId }];
    case "persona": {
      const p = await tx.demoPersona.findUnique({ where: { orgId_key: { orgId, key: a.persona } } });
      return p ? [{ membershipId: p.membershipId }] : [];
    }
    case "requester":
      return [{ membershipId: ctx.request.requesterId }];
    case "student":
      return ctx.student?.membershipId ? [{ membershipId: ctx.student.membershipId }] : [];
    case "guardians": {
      if (!ctx.student) return [];
      const links = await tx.guardianLink.findMany({
        where: { orgId, studentId: ctx.student.id, canApprove: true },
        include: { guardian: true },
        orderBy: { isPrimary: "desc" },
      });
      return links.map((l) => ({ membershipId: l.guardian.membershipId, guardianId: l.guardianId }));
    }
    case "case_assignee":
      return ctx.caseAssigneeId ? [{ membershipId: ctx.caseAssigneeId }] : [];
    case "class_teacher": {
      if (!ctx.student) return [];
      if (a.subjectField) {
        const subject = await subjectFrom(ec, ctx.form[a.subjectField]);
        if (!subject) return [];
        const enr = await tx.enrollment.findFirst({
          where: { orgId, studentId: ctx.student.id, class: { subjectId: subject.id } },
          include: { class: true },
        });
        if (enr?.class.teacherMembershipId) return [{ membershipId: enr.class.teacherMembershipId }];
        const anyClass = await tx.schoolClass.findFirst({ where: { orgId, subjectId: subject.id, gradeLevel: ctx.student.grade } });
        return anyClass?.teacherMembershipId ? [{ membershipId: anyClass.teacherMembershipId }] : [];
      }
      const homeroom = await tx.enrollment.findFirst({
        where: { orgId, studentId: ctx.student.id, class: { isHomeroom: true } },
        include: { class: true },
      });
      return homeroom?.class.teacherMembershipId ? [{ membershipId: homeroom.class.teacherMembershipId }] : [];
    }
    case "department_head": {
      if (a.departmentKey) {
        const d = await tx.department.findUnique({ where: { orgId_key: { orgId, key: a.departmentKey } } });
        return d?.headMembershipId ? [{ membershipId: d.headMembershipId }] : [];
      }
      if (a.subjectField) {
        const subject = await subjectFrom(ec, ctx.form[a.subjectField]);
        return subject?.department?.headMembershipId ? [{ membershipId: subject.department.headMembershipId }] : [];
      }
      return [];
    }
    case "role": {
      if (a.role === "appointment_host") return ctx.appointmentHostId ? [{ membershipId: ctx.appointmentHostId }] : [];
      const members = await membersWithRole(ec, a.role);
      return members.map((m) => ({ membershipId: m.membershipId }));
    }
  }
}

/** Pick one owner for a task or case: prefer staff whose caseload covers the student's grade, then the least busy. */
export async function resolveSingle(ec: ExecCtx, a: Assignee, ctx: RunContext): Promise<string | null> {
  if (a.kind === "role" && a.role !== "appointment_host") {
    const members = await membersWithRole(ec, a.role);
    if (members.length === 0) return null;
    if (members.length === 1) return members[0].membershipId;
    const grade = ctx.student?.grade;
    const covering = grade ? members.filter((m) => m.gradeLevels.includes(grade)) : [];
    const pool = covering.length ? covering : members;
    if (pool.length === 1) return pool[0].membershipId;
    const loads = await Promise.all(
      pool.map((m) => ec.tx.case.count({ where: { orgId: ec.orgId, assigneeId: m.membershipId, status: { in: ["NEW", "OPEN", "IN_PROGRESS"] } } })),
    );
    let best = 0;
    loads.forEach((l, i) => {
      if (l < loads[best]) best = i;
    });
    return pool[best].membershipId;
  }
  const all = await resolveAssignee(ec, a, ctx);
  return all.find((x) => x.membershipId)?.membershipId ?? null;
}
