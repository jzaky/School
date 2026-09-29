import "server-only";
import { cache } from "react";
import type { Ctx } from "@/server/context";
import { personName } from "@/lib/i18n-data";
import { actorFromCtx, canApprovePlan, canEditPlan, canViewStudent, type EngineActor } from "./access";

/** Canonical subject names (global table), for labels. */
export const subjectNames = cache(async (ctx: Ctx) => {
  const rows = await ctx.db.canonicalSubject.findMany({ select: { key: true, nameEn: true, nameAr: true } });
  return Object.fromEntries(rows.map((r) => [r.key, { en: r.nameEn, ar: r.nameAr }]));
});

export type EngineFocus = {
  actor: EngineActor;
  student: { id: string; name: string; gradeLevel: number; curriculum: string } | null;
  canEdit: boolean;
  canApprove: boolean;
  /** Parents with several children: the picker options. */
  options: Array<{ value: string; label: string }>;
};

/** The student a pathway page is about. Students get themselves, parents their child (first by default). */
export async function engineFocus(ctx: Ctx, requested?: string | null): Promise<EngineFocus> {
  const actor = await actorFromCtx(ctx);
  let id: string | null = null;
  let options: EngineFocus["options"] = [];
  if (ctx.isStudent) id = ctx.membership.student?.id ?? null;
  else if (ctx.isParent) {
    const ids = actor.visibleStudentIds ?? [];
    const kids = ids.length ? await ctx.db.student.findMany({ where: { id: { in: ids }, orgId: ctx.orgId }, orderBy: { gradeLevel: "desc" } }) : [];
    options = kids.length > 1 ? kids.map((k) => ({ value: k.id, label: personName(k, ctx.locale) })) : [];
    id = requested && ids.includes(requested) ? requested : (kids[0]?.id ?? null);
  } else id = requested ?? null;
  if (!id || !canViewStudent(actor, id)) return { actor, student: null, canEdit: false, canApprove: false, options };
  const s = await ctx.db.student.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!s) return { actor, student: null, canEdit: false, canApprove: false, options };
  return {
    actor,
    student: { id: s.id, name: personName(s, ctx.locale), gradeLevel: s.gradeLevel, curriculum: s.curriculum },
    canEdit: canEditPlan(actor, s.id),
    canApprove: canApprovePlan(actor, s.id),
    options,
  };
}

/** Link to a student's pathway page. Students and parents use the short path with ?student= for siblings. */
export const pathwayHref = (ctx: Ctx, studentId: string, sub = "") => (ctx.isStudent ? `/career/pathways${sub}` : ctx.isParent ? `/career/pathways${sub}?student=${studentId}` : `/career/pathways/${studentId}${sub}`);
