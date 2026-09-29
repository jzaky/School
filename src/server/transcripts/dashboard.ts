// Counselor dashboard: a caseload view across students built from CACHED engine results
// (RequirementMatch rows), so opening it never re-evaluates every student. "Recompute" refreshes the cache
// for the filtered students on request. Tenant-scoped through the actor's client; staff only.
import type { Prisma, SchoolCurriculum } from "@prisma/client";
import { audit } from "@/server/audit/audit";
import { EngineAccessError, type EngineActor } from "@/server/pathway-engine/access";
import { computeMatches } from "@/server/pathway-engine/service";
import { MATCH_STATUSES, type ClassToTake, type EvalResult, type LineResult, type MatchStatus } from "@/server/pathway-engine/types";
import { canUseDashboard } from "./access";
import { payloadOf } from "./service";

export type DashboardFilters = { grade?: number | null; curriculum?: SchoolCurriculum | null; counselor?: string | null };

export type DashStudent = { id: string; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; gradeLevel: number; curriculum: SchoolCurriculum };

export type Dashboard = {
  students: DashStudent[];
  counts: Record<MatchStatus, number>;
  studentsWithMatches: number;
  lastComputedAt: Date | null;
  awaiting: Array<{ planId: string; studentId: string; name: string; items: number; proposedById: string | null; updatedAt: Date }>;
  missing: Array<{ studentId: string; programs: number; total: number; top: LineResult | null; topCount: number }>;
  notInPlan: Array<{ studentId: string; planId: string; classes: ClassToTake[]; programs: number }>;
  mappings: Array<{ studentId: string; courses: Array<{ id: string; name: string }> }>;
  pendingImports: Array<{ id: string; studentId: string; fileName: string; needsReview: number; rows: number; createdAt: Date }>;
  changes: Array<{ id: string; programId: string; summaryEn: string; summaryAr: string | null; severity: string | null; detectedAt: Date; status: string; studentIds: string[] }>;
  programNames: Map<string, { nameEn: string; nameAr: string; uniEn: string; uniAr: string }>;
  counselors: Array<{ id: string; nameEn: string; nameAr: string | null }>;
};

const CHANGE_WINDOW_DAYS = 120;

async function scopedStudents(actor: EngineActor, f: DashboardFilters): Promise<DashStudent[]> {
  const where: Prisma.StudentWhereInput = { orgId: actor.orgId, status: "ACTIVE", gradeLevel: f.grade ? f.grade : { gte: 9 } };
  if (f.curriculum) where.curriculum = f.curriculum;
  if (actor.visibleStudentIds) where.id = { in: actor.visibleStudentIds };
  if (f.counselor) {
    const profiles = await actor.db.careerProfile.findMany({ where: { orgId: actor.orgId, advisorId: f.counselor }, select: { studentId: true } });
    const apps = await actor.db.application.findMany({ where: { orgId: actor.orgId, counselorId: f.counselor }, select: { studentId: true }, distinct: ["studentId"] });
    const ids = [...new Set([...profiles.map((p) => p.studentId), ...apps.map((a) => a.studentId)])];
    where.AND = [{ id: { in: ids } }];
  }
  return actor.db.student.findMany({
    where,
    select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, curriculum: true },
    orderBy: [{ gradeLevel: "desc" }, { lastNameEn: "asc" }],
    take: 800,
  });
}

/** The line text key used to find the most common missing requirement. */
const lineKey = (l: LineResult) => `${l.kind}|${l.type}|${(l.keys ?? []).slice().sort().join("+")}|${l.minimumLevel ?? ""}|${l.required ?? ""}`;

export async function loadDashboard(actor: EngineActor, f: DashboardFilters, now = new Date()): Promise<Dashboard> {
  if (!canUseDashboard(actor)) throw new EngineAccessError("forbidden");
  const { db, orgId } = actor;
  const students = await scopedStudents(actor, f);
  const ids = students.map((s) => s.id);
  const [plans, matches, review, imports, profiles] = await Promise.all([
    db.studentCoursePlan.findMany({ where: { orgId, studentId: { in: ids }, status: { in: ["DRAFT", "PROPOSED", "APPROVED"] } }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { items: true } } } }),
    db.requirementMatch.findMany({ where: { orgId, studentId: { in: ids } }, select: { studentId: true, programId: true, planId: true, status: true, requiredMissing: true, detail: true, computedAt: true } }),
    db.studentCourse.findMany({ where: { orgId, studentId: { in: ids }, mappingStatus: "NEEDS_REVIEW" }, select: { id: true, studentId: true, localName: true }, orderBy: { gradeLevel: "desc" } }),
    db.transcriptImport.findMany({ where: { orgId, status: "PENDING", studentId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.careerProfile.findMany({ where: { orgId, advisorId: { not: null } }, select: { advisorId: true }, distinct: ["advisorId"] }),
  ]);

  // Current plan per student (most recently changed active plan).
  const planOf = new Map<string, (typeof plans)[number]>();
  for (const p of plans) if (!planOf.has(p.studentId)) planOf.set(p.studentId, p);

  // Cached matches: the rows for the student's current plan when there are any, else the record-only rows.
  const byStudent = new Map<string, typeof matches>();
  for (const m of matches) {
    const list = byStudent.get(m.studentId) ?? [];
    list.push(m);
    byStudent.set(m.studentId, list);
  }
  const current = new Map<string, typeof matches>();
  for (const [sid, list] of byStudent) {
    const planId = planOf.get(sid)?.id ?? null;
    const forPlan = planId ? list.filter((m) => m.planId === planId) : [];
    current.set(sid, forPlan.length ? forPlan : list.filter((m) => m.planId === null));
  }

  const counts = Object.fromEntries(MATCH_STATUSES.map((s) => [s, 0])) as Record<MatchStatus, number>;
  let lastComputedAt: Date | null = null;
  const missing: Dashboard["missing"] = [];
  const notInPlan: Dashboard["notInPlan"] = [];
  for (const s of students) {
    const list = current.get(s.id) ?? [];
    if (!list.length) continue;
    for (const m of list) {
      counts[m.status]++;
      if (!lastComputedAt || m.computedAt > lastComputedAt) lastComputedAt = m.computedAt;
    }
    const missingRows = list.filter((m) => m.status === "MISSING_REQUIREMENTS");
    if (missingRows.length) {
      const tally = new Map<string, { line: LineResult; n: number }>();
      for (const m of missingRows) {
        const seen = new Set<string>();
        for (const l of (m.detail as unknown as EvalResult).lines ?? []) {
          if (l.advisory || l.status !== "not_met") continue;
          const k = lineKey(l);
          if (seen.has(k)) continue;
          seen.add(k);
          const t = tally.get(k) ?? { line: l, n: 0 };
          t.n++;
          tally.set(k, t);
        }
      }
      const top = [...tally.values()].sort((a, b) => b.n - a.n || (a.line.kind === "subject" ? -1 : 1))[0];
      missing.push({ studentId: s.id, programs: missingRows.length, total: list.length, top: top?.line ?? null, topCount: top?.n ?? 0 });
    }
    // Required classes the plan does not cover in any year: the plan-based evaluation still lists them to take.
    const plan = planOf.get(s.id);
    if (plan && list.some((m) => m.planId === plan.id)) {
      const classes = new Map<string, ClassToTake>();
      let programs = 0;
      for (const m of list) {
        const c = (m.detail as unknown as EvalResult).classesToTake ?? [];
        if (c.length) programs++;
        for (const x of c) classes.set(x.subjectKeys.slice().sort().join("+") + (x.minimumLevel ?? ""), x);
      }
      if (classes.size) notInPlan.push({ studentId: s.id, planId: plan.id, classes: [...classes.values()].slice(0, 4), programs });
    }
  }
  missing.sort((a, b) => b.programs - a.programs);
  notInPlan.sort((a, b) => b.programs - a.programs);

  const awaiting = plans
    .filter((p) => p.status === "PROPOSED" && planOf.get(p.studentId)?.id === p.id)
    .map((p) => ({ planId: p.id, studentId: p.studentId, name: p.name, items: p._count.items, proposedById: p.proposedById, updatedAt: p.updatedAt }))
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

  const mappingsBy = new Map<string, Array<{ id: string; name: string }>>();
  for (const r of review) {
    const l = mappingsBy.get(r.studentId) ?? [];
    l.push({ id: r.id, name: r.localName });
    mappingsBy.set(r.studentId, l);
  }
  const pendingImports = imports.map((i) => {
    const p = payloadOf(i.rows);
    return { id: i.id, studentId: i.studentId!, fileName: i.fileName, rows: p.rows.length, needsReview: p.rows.filter((r) => r.decision === "NEEDS_REVIEW").length, createdAt: i.createdAt };
  });

  // Requirement changes on programmes these students target (plan targets, cached matches, applications).
  const apps = await db.application.findMany({ where: { orgId, studentId: { in: ids }, programId: { not: null } }, select: { studentId: true, programId: true } });
  const studentsByProgram = new Map<string, Set<string>>();
  const add = (pid: string, sid: string) => {
    const set = studentsByProgram.get(pid) ?? new Set<string>();
    set.add(sid);
    studentsByProgram.set(pid, set);
  };
  for (const p of planOf.values()) for (const pid of p.targetProgramIds) add(pid, p.studentId);
  for (const [sid, list] of current) for (const m of list) add(m.programId, sid);
  for (const a of apps) add(a.programId!, a.studentId);
  const since = new Date(now.getTime() - CHANGE_WINDOW_DAYS * 86_400_000);
  const changeRows = studentsByProgram.size
    ? await db.requirementChange.findMany({ where: { programId: { in: [...studentsByProgram.keys()] }, detectedAt: { gte: since } }, orderBy: { detectedAt: "desc" }, take: 20 })
    : [];
  const changes = changeRows
    .map((c) => {
      const d = (c.diff ?? {}) as { severity?: string; summaryAr?: string; review?: { outcome?: string } };
      return { id: c.id, programId: c.programId, summaryEn: c.summaryEn, summaryAr: d.summaryAr ?? null, severity: d.severity ?? null, detectedAt: c.detectedAt, status: c.status, studentIds: [...(studentsByProgram.get(c.programId) ?? [])], dismissed: d.review?.outcome === "DISMISSED" };
    })
    .filter((c) => !c.dismissed)
    .map(({ dismissed: _d, ...c }) => c);

  const programIds = [...new Set([...changes.map((c) => c.programId)])];
  const progs = programIds.length ? await db.universityProgram.findMany({ where: { id: { in: programIds } }, select: { id: true, nameEn: true, nameAr: true, universityId: true } }) : [];
  const unis = progs.length ? await db.university.findMany({ where: { id: { in: [...new Set(progs.map((p) => p.universityId))] } }, select: { id: true, nameEn: true, nameAr: true } }) : [];
  const programNames = new Map(progs.map((p) => {
    const u = unis.find((x) => x.id === p.universityId);
    return [p.id, { nameEn: p.nameEn, nameAr: p.nameAr, uniEn: u?.nameEn ?? "", uniAr: u?.nameAr ?? "" }];
  }));

  const counselorIds = [...new Set([...profiles.map((p) => p.advisorId!).filter(Boolean), actor.membershipId])];
  const members = await db.membership.findMany({ where: { id: { in: counselorIds }, status: "ACTIVE" }, include: { user: { select: { nameEn: true, nameAr: true } } } });
  const counselors = members.filter((m) => m.user).map((m) => ({ id: m.id, nameEn: m.user.nameEn, nameAr: m.user.nameAr })).sort((a, b) => a.nameEn.localeCompare(b.nameEn));

  return {
    students,
    counts,
    studentsWithMatches: [...current.values()].filter((l) => l.length).length,
    lastComputedAt,
    awaiting,
    missing,
    notInPlan,
    mappings: [...mappingsBy.entries()].map(([studentId, courses]) => ({ studentId, courses })),
    pendingImports,
    changes,
    programNames,
    counselors,
  };
}

/**
 * Refresh cached matches for the filtered caseload (students with a plan or a course record), capped so a
 * click never runs for long. Each student is evaluated against their current plan, like their pathway page.
 */
export async function recomputeCaseload(actor: EngineActor, f: DashboardFilters, max = 60) {
  if (!canUseDashboard(actor)) throw new EngineAccessError("forbidden");
  const students = await scopedStudents(actor, f);
  const ids = students.map((s) => s.id);
  const [plans, courses] = await Promise.all([
    actor.db.studentCoursePlan.findMany({ where: { orgId: actor.orgId, studentId: { in: ids }, status: { in: ["DRAFT", "PROPOSED", "APPROVED"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, studentId: true } }),
    actor.db.studentCourse.findMany({ where: { orgId: actor.orgId, studentId: { in: ids } }, select: { studentId: true }, distinct: ["studentId"] }),
  ]);
  const planOf = new Map<string, string>();
  for (const p of plans) if (!planOf.has(p.studentId)) planOf.set(p.studentId, p.id);
  const targets = ids.filter((id) => planOf.has(id) || courses.some((c) => c.studentId === id)).slice(0, max);
  let evaluated = 0;
  for (const sid of targets) {
    await computeMatches(actor, sid, { planId: planOf.get(sid) ?? null });
    evaluated++;
  }
  await audit(actor.db, actor.orgId, { actorId: actor.membershipId, action: "pathways.dashboard.recompute", entityType: "RequirementMatch", meta: { students: evaluated, filters: { grade: f.grade ?? null, curriculum: f.curriculum ?? null, counselor: !!f.counselor } } });
  return { evaluated, capped: ids.length > max && targets.length === max };
}
