import "server-only";
// What the "Choose my courses" screen needs for one student and year: the window state, who may change
// choices and how, who chose what, sign-off, helpers and exceptions. Built for the viewer (Ctx), so a
// helping teacher sees only course selection data.
import type { Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { personName, pick, userName } from "@/lib/i18n-data";
import { actorFromCtx, canViewStudent, type EngineActor } from "@/server/pathway-engine/access";
import {
  activeHelpers,
  canAssist,
  canSignOff,
  editAccess,
  getSelectionSettings,
  guardianMembers,
  membersWith,
  responsibleStaff,
  selectionActorFromCtx,
  windowsForYears,
  writerFor,
  type ResponsibleRole,
} from "./selection";
import { helperEngineActor } from "./selection-scope";
import { windowState } from "@/lib/selection-window";

type StudentLite = { id: string; gradeLevel: number; membershipId: string | null; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string };

/**
 * The pathway engine actor for the picker's university impact. A helping teacher without pathways.view
 * sees the same guidance the student sees, for this student only, and nothing else.
 */
export async function pickerEngineActor(ctx: Ctx, studentId: string): Promise<EngineActor | null> {
  const actor = await actorFromCtx(ctx);
  if (canViewStudent(actor, studentId)) return actor;
  const writer = await tenantTx(ctx.orgId, (tx) => writerFor(tx, ctx.orgId, selectionActorFromCtx(ctx), studentId));
  if (writer.role !== "helper") return null;
  return helperEngineActor(actor, studentId);
}

export async function selectionView(ctx: Ctx, student: StudentLite, year: { id: string; nameEn: string; nameAr: string }, now = new Date()) {
  const { orgId, locale } = ctx;
  const actor = selectionActorFromCtx(ctx);
  return tenantTx(orgId, async (tx) => {
    const [access, writer, settings, submission, helpersRaw, responsible, guardians, regs] = await Promise.all([
      editAccess(tx, orgId, student, year.id, now),
      writerFor(tx, orgId, actor, student.id, now),
      getSelectionSettings(tx, orgId),
      tx.courseSelectionSubmission.findFirst({ where: { orgId, studentId: student.id, academicYearId: year.id } }),
      activeHelpers(tx, orgId, student.id, now),
      responsibleStaff(tx, orgId, student.id),
      guardianMembers(tx, orgId, student.id),
      tx.subjectRegistration.findMany({ where: { orgId, academicYearId: year.id, studentId: student.id, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } }, select: { subjectId: true, createdById: true, chosenAt: true, createdAt: true } }),
    ]);
    const assist = actor.isStaff ? await canAssist(tx, orgId, actor, student.id) : false;
    const assistStaff = await membersWith(tx, orgId, responsible.map((r) => r.membershipId), "registration.assist");
    const exceptions = assist ? await tx.courseSelectionException.findMany({ where: { orgId, studentId: student.id, academicYearId: year.id, revokedAt: null, until: { gt: now } }, orderBy: { until: "desc" } }) : [];
    const ids = [...new Set([...responsible.map((r) => r.membershipId), ...helpersRaw.flatMap((h) => [h.helperId, h.grantedById]), ...regs.map((r) => r.createdById ?? ""), submission?.lastById ?? "", submission?.signedOffById ?? "", ...exceptions.map((e) => e.grantedById)].filter(Boolean))];
    const members = ids.length ? await tx.membership.findMany({ where: { orgId, id: { in: ids } }, include: { user: { select: { nameEn: true, nameAr: true } }, student: true, guardian: true } }) : [];
    const nameOf = (id: string | null | undefined) => {
      const m = members.find((x) => x.id === id);
      if (!m) return "";
      const p = m.student ?? m.guardian;
      return p ? personName(p, locale) : userName(m.user, locale);
    };
    const roleOf = (id: string) => {
      const r = responsible.find((x) => x.membershipId === id);
      if (r) return r.roles[0];
      if (guardians.some((g) => g.membershipId === id)) return "parent" as const;
      return "staff" as const;
    };
    const windows = await windowsForYears(tx, orgId, [year.id]);
    const myWindows = windows.filter((w) => w.gradeLevels.includes(student.gradeLevel));
    const upcoming = myWindows.filter((w) => windowState(w, now) !== "closed").sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
    const defaultUntil = (access.state === "open" && access.window ? access.window.closesAt : (upcoming[0]?.closesAt ?? null))?.toISOString() ?? null;
    const relation = (g: (typeof guardians)[number]) => g.guardian;
    // People who can be asked to help: the student's own teachers, counselor and advisor with registration.assist,
    // and linked guardians when the school lets parents choose only when allowed.
    const candidates = [
      ...responsible.filter((r) => assistStaff.has(r.membershipId)).map((r) => ({ membershipId: r.membershipId, name: nameOf(r.membershipId), role: r.roles[0] as ResponsibleRole | "parent" | "staff", kind: "STAFF" as const })),
      ...(settings.parentChoice === "WHEN_ALLOWED" ? guardians.map((g) => ({ membershipId: g.membershipId, name: personName(relation(g), locale), role: "parent" as const, kind: "GUARDIAN" as const })) : []),
    ].filter((c) => c.membershipId !== actor.membershipId || actor.isStaff);
    // Staff turning it on may also name themselves.
    if (assist && actor.can("registration.assist") && !candidates.some((c) => c.membershipId === actor.membershipId)) {
      candidates.unshift({ membershipId: actor.membershipId, name: userName(ctx.user, locale), role: "staff", kind: "STAFF" });
    }
    const helpers = helpersRaw.map((h) => ({ id: h.id, helperId: h.helperId, name: nameOf(h.helperId), role: roleOf(h.helperId), until: h.until.toISOString(), byStudent: h.byStudent, grantedBy: nameOf(h.grantedById), kind: h.kind }));
    const myGrant = writer.role === "helper" ? writer.grant : null;
    const signOff = settings.signOffRequired && submission?.status === "SUBMITTED" ? await canSignOff(tx, orgId, actor, student.id, submission) : null;
    // Who to ask when choosing is closed: homeroom teacher and counselor first.
    const contacts = responsible
      .filter((r) => r.roles.some((x) => x === "homeroom" || x === "counselor" || x === "advisor"))
      .slice(0, 3)
      .map((r) => ({ name: nameOf(r.membershipId), role: r.roles.find((x) => x !== "teacher") ?? r.roles[0] }));
    const studentFirst = pick(locale, student.firstNameEn, student.firstNameAr);
    const chosenBy = Object.fromEntries(
      regs
        .filter((r) => r.createdById && r.createdById !== student.membershipId && nameOf(r.createdById))
        .map((r) => [r.subjectId, { by: nameOf(r.createdById), at: (r.chosenAt ?? r.createdAt).toISOString() }]),
    );
    return {
      access,
      writer,
      settings,
      submission: submission ? { ...submission, lastByName: nameOf(submission.lastById), signedOffByName: nameOf(submission.signedOffById) } : null,
      helpers,
      candidates,
      defaultUntil,
      contacts,
      signOff,
      assist,
      exceptions: exceptions.map((e) => ({ id: e.id, until: e.until.toISOString(), reason: e.reason, grantedBy: nameOf(e.grantedById) })),
      myGrant: myGrant ? { id: myGrant.id, until: myGrant.until.toISOString(), byStudent: myGrant.byStudent, grantedBy: nameOf(myGrant.grantedById) } : null,
      studentFirst,
      chosenBy,
    };
  });
}

export type SelectionViewData = Awaited<ReturnType<typeof selectionView>>;
