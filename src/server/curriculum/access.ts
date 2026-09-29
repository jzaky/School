// Who can see, edit and review lesson plans. One place for the rules so pages and actions agree.
import "server-only";
import type { LessonPlan, Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";

export const canUseCurriculum = (ctx: Ctx) => ctx.isStaff && (ctx.can("curriculum.plan") || ctx.can("curriculum.review") || ctx.can("curriculum.manage"));

export type ReviewScope = { all: boolean; subjectIds: string[] };

/** School leaders review every subject; a head of department reviews the subjects of the departments they lead. */
export async function reviewScope(ctx: Ctx): Promise<ReviewScope> {
  if (!ctx.isStaff || !ctx.can("curriculum.review")) return { all: false, subjectIds: [] };
  if (ctx.can("admin.access")) return { all: true, subjectIds: [] };
  const subjects = await ctx.db.subject.findMany({ where: { department: { headMembershipId: ctx.membershipId } }, select: { id: true } });
  return { all: false, subjectIds: subjects.map((s) => s.id) };
}

export const inScope = (scope: ReviewScope, subjectId: string) => scope.all || scope.subjectIds.includes(subjectId);

export function reviewScopeWhere(scope: ReviewScope): Prisma.LessonPlanWhereInput {
  return scope.all ? {} : { subjectId: { in: scope.subjectIds } };
}

/** Drafts are private to their author. Everything else is shared with colleagues who plan or review. */
export function visiblePlanWhere(ctx: Ctx): Prisma.LessonPlanWhereInput {
  return { OR: [{ authorId: ctx.membershipId }, { status: { not: "DRAFT" } }] };
}

export const canSeePlan = (ctx: Ctx, plan: Pick<LessonPlan, "authorId" | "status">) => canUseCurriculum(ctx) && (plan.authorId === ctx.membershipId || plan.status !== "DRAFT");

export const canEditPlan = (ctx: Ctx, plan: Pick<LessonPlan, "authorId" | "status">) =>
  ctx.can("curriculum.plan") && plan.authorId === ctx.membershipId && (plan.status === "DRAFT" || plan.status === "CHANGES_REQUESTED");

/** The current academic year's terms, oldest first. */
export async function currentTerms(ctx: Pick<Ctx, "db">) {
  const year = await ctx.db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: { orderBy: { startsOn: "asc" } } } });
  return year?.terms ?? [];
}
