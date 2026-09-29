// Task plan for one application: templates per checklist item, late-start compression, dependency alignment
// and reconciliation with tasks generated earlier. Pure functions.
// Reimplements generatePlan, adaptLateStartSchedule_, alignDependencyDates_, mergeTask_ and reconcile from
// granitehq/college-tools src/task-planner.js (MIT, see docs/third-party.md).
import { DAY_MS, startOfDay, urgencyFor, type TaskPriority } from "./deadlines";
import { itemComplete, type ItemKind, type ItemStatus } from "./types";

export type Role = "student" | "counselor";

type Template = {
  role: Role;
  /** Days relative to the submission deadline. Negative is before. 0 is the deadline itself (fixed). */
  offsetDays: number;
  /** Item kinds that must be finished first. */
  after: ItemKind[];
  en: (title: string) => string;
  ar: (title: string) => string;
};

const PRE_SUBMISSION: ItemKind[] = ["PERSONAL_STATEMENT", "ESSAY", "TEST", "LANGUAGE_TEST", "PORTFOLIO", "TRANSCRIPT", "PREDICTED_GRADES", "PASSPORT", "RECOMMENDATION", "OTHER"];

export const TEMPLATES: Record<ItemKind, Template> = {
  TEST: { role: "student", offsetDays: -60, after: [], en: (t) => `Take and send: ${t}`, ar: (t) => `أداء الاختبار وإرسال النتيجة: ${t}` },
  LANGUAGE_TEST: { role: "student", offsetDays: -45, after: [], en: (t) => `Take and send: ${t}`, ar: (t) => `أداء الاختبار وإرسال النتيجة: ${t}` },
  PASSPORT: { role: "student", offsetDays: -30, after: [], en: (t) => `Prepare: ${t}`, ar: (t) => `تجهيز: ${t}` },
  PERSONAL_STATEMENT: { role: "student", offsetDays: -28, after: [], en: (t) => `Finish: ${t}`, ar: (t) => `إنهاء: ${t}` },
  ESSAY: { role: "student", offsetDays: -21, after: ["PERSONAL_STATEMENT"], en: (t) => `Finish: ${t}`, ar: (t) => `إنهاء: ${t}` },
  PORTFOLIO: { role: "student", offsetDays: -21, after: [], en: (t) => `Upload: ${t}`, ar: (t) => `رفع: ${t}` },
  OTHER: { role: "student", offsetDays: -14, after: [], en: (t) => `Complete: ${t}`, ar: (t) => `إكمال: ${t}` },
  RECOMMENDATION: { role: "counselor", offsetDays: -42, after: [], en: (t) => `Assign a teacher: ${t}`, ar: (t) => `تكليف معلم: ${t}` },
  PREDICTED_GRADES: { role: "counselor", offsetDays: -21, after: [], en: (t) => `Submit: ${t}`, ar: (t) => `إرسال: ${t}` },
  TRANSCRIPT: { role: "counselor", offsetDays: -14, after: ["PREDICTED_GRADES"], en: (t) => `Send: ${t}`, ar: (t) => `إرسال: ${t}` },
  FORM: { role: "student", offsetDays: 0, after: PRE_SUBMISSION, en: (t) => t, ar: (t) => t },
  INTERVIEW: { role: "student", offsetDays: 21, after: ["FORM"], en: (t) => `Prepare for: ${t}`, ar: (t) => `الاستعداد: ${t}` },
  FINANCIAL: { role: "student", offsetDays: 30, after: ["FORM"], en: (t) => `Submit: ${t}`, ar: (t) => `تقديم: ${t}` },
};

export type PlanItem = { id: string; kind: ItemKind; titleEn: string; titleAr: string; status: ItemStatus | string; /** Recommendation already assigned to a teacher. */ assigned?: boolean };

export type Flag = "needs_date" | "late_start" | "not_feasible" | "after_prerequisite" | "dependency_conflict" | "overdue";

export type PlannedTask = {
  key: string;
  itemId: string;
  kind: ItemKind;
  role: Role;
  titleEn: string;
  titleAr: string;
  /** The ideal date before any compression or alignment. */
  idealDate: Date | null;
  dueDate: Date | null;
  offsetDays: number;
  priority: TaskPriority;
  flags: Flag[];
  dependencies: string[];
  /** The item is done or waived, so the task should be (or stay) complete. */
  complete: boolean;
};

export const taskKey = (applicationId: string, itemId: string, cycle: number, role: Role) => `app:${applicationId}:${itemId}:${cycle}:${role}`;

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const flag = (t: PlannedTask, f: Flag) => {
  if (!t.flags.includes(f)) t.flags.push(f);
};
const bump = (p: TaskPriority, to: TaskPriority): TaskPriority => {
  const order: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
  return order.indexOf(to) > order.indexOf(p) ? to : p;
};

/** Generate the task plan for one application's checklist against its submission deadline. */
export function generatePlan(input: { applicationId: string; cycle: number; items: PlanItem[]; deadline: Date | null; today: Date }): PlannedTask[] {
  const today = startOfDay(input.today);
  const deadline = input.deadline ? startOfDay(input.deadline) : null;
  const tasks: PlannedTask[] = input.items.map((item) => {
    const tpl = TEMPLATES[item.kind] ?? TEMPLATES.OTHER;
    const ideal = deadline ? addDays(deadline, tpl.offsetDays) : null;
    return {
      key: taskKey(input.applicationId, item.id, input.cycle, tpl.role),
      itemId: item.id,
      kind: item.kind,
      role: tpl.role,
      titleEn: tpl.en(item.titleEn),
      titleAr: tpl.ar(item.titleAr),
      idealDate: ideal,
      dueDate: ideal,
      offsetDays: tpl.offsetDays,
      priority: "LOW",
      flags: ideal ? [] : ["needs_date"],
      dependencies: [],
      // An assigned recommendation is the teacher's task now; the counselor's assignment step is done.
      complete: itemComplete(item.status) || (item.kind === "RECOMMENDATION" && !!item.assigned),
    };
  });
  // Dependencies by kind: a task waits for every item of the kinds its template lists.
  for (const t of tasks) {
    const tpl = TEMPLATES[t.kind] ?? TEMPLATES.OTHER;
    t.dependencies = tasks.filter((d) => d !== t && tpl.after.includes(d.kind)).map((d) => d.key);
  }
  if (deadline) adaptLateStart(tasks, today, deadline);
  alignDependencies(tasks);
  for (const t of tasks) {
    const u = urgencyFor(t.dueDate, today);
    t.priority = bump(t.priority, u.priority);
    if (u.bucket === "overdue" && !t.complete) flag(t, "overdue");
  }
  return tasks;
}

/**
 * Map an ideal long-lead schedule into the time left before the deadline. Only work before the deadline
 * moves; the deadline itself and anything after it never do. Progress through the ideal span is kept.
 */
export function adaptLateStart(tasks: PlannedTask[], today: Date, deadline: Date) {
  if (deadline <= today) return;
  const eligible = tasks.filter((t) => t.offsetDays < 0 && t.idealDate && t.idealDate <= deadline);
  const idealStart = eligible.reduce<Date | null>((min, t) => (!min || t.idealDate! < min ? t.idealDate! : min), null);
  if (!idealStart || idealStart >= today) return;
  const idealSpan = Math.max(1, deadline.getTime() - idealStart.getTime());
  const available = deadline.getTime() - today.getTime();
  const latest = addDays(deadline, -1);
  for (const t of eligible) {
    const progress = Math.max(0, Math.min(1, (t.idealDate!.getTime() - idealStart.getTime()) / idealSpan));
    let mapped = startOfDay(new Date(today.getTime() + Math.round(progress * available)));
    if (mapped > latest) mapped = latest;
    if (mapped < today) {
      mapped = today;
      t.priority = "URGENT";
      flag(t, "not_feasible");
    } else {
      if (t.idealDate! < today) t.priority = bump(t.priority, "HIGH");
      flag(t, "late_start");
    }
    t.dueDate = mapped;
  }
}

/** Movable work never lands before its prerequisites. A fixed date that would have to move is flagged instead. */
export function alignDependencies(tasks: PlannedTask[]) {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  for (let pass = 0; pass < tasks.length; pass++) {
    let changed = false;
    for (const t of tasks) {
      let latest: Date | null = null;
      for (const k of t.dependencies) {
        const d = byKey.get(k);
        if (d?.dueDate && !d.complete && (!latest || d.dueDate > latest)) latest = d.dueDate;
      }
      if (!latest || !t.dueDate || latest <= t.dueDate) continue;
      if (t.offsetDays === 0) {
        if (!t.flags.includes("dependency_conflict")) {
          t.priority = "URGENT";
          flag(t, "dependency_conflict");
        }
        continue;
      }
      t.dueDate = new Date(latest.getTime());
      flag(t, "after_prerequisite");
      changed = true;
    }
    if (!changed) break;
  }
}

// ---------------------------------------------------------------------------
// Reconcile with tasks generated earlier
// ---------------------------------------------------------------------------

export type ExistingTask = {
  key: string;
  taskId: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  dueAt: Date | null;
  /** The date the generator last set. If a person changed the date since, it counts as locked. */
  generatedDueAt: Date | null;
  dateLocked: boolean;
  archivedReason: string | null;
};

export type TaskChange = {
  key: string;
  taskId: string;
  titleEn: string;
  titleAr: string;
  priority: TaskPriority;
  dueAt: Date | null;
  generatedDueAt: Date | null;
  dateLocked: boolean;
  status?: "TODO" | "DONE";
};

export type ReconcileResult = {
  create: PlannedTask[];
  update: TaskChange[];
  keep: string[];
  archive: Array<{ key: string; taskId: string; reason: string }>;
};

const sameDay = (a: Date | null, b: Date | null) => (!a && !b) || (!!a && !!b && startOfDay(a).getTime() === startOfDay(b).getTime());

/**
 * Merge a fresh plan with existing tasks. Completed tasks are an audit record and never change. Locked or
 * hand-edited dates are kept. Tasks the plan no longer contains are archived with a reason, and a task the
 * system archived earlier comes back if it applies again.
 */
export function reconcile(generated: PlannedTask[], existing: ExistingTask[], archiveReason = "No longer applicable after the checklist changed"): ReconcileResult {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const seen = new Set<string>();
  const out: ReconcileResult = { create: [], update: [], keep: [], archive: [] };
  for (const g of generated) {
    seen.add(g.key);
    const e = byKey.get(g.key);
    if (!e) {
      if (!g.complete) out.create.push(g);
      continue;
    }
    if (e.status === "DONE") {
      out.keep.push(e.key);
      continue;
    }
    if (e.status === "CANCELLED") {
      // A person cancelled it: respect that. The system archived it: bring it back if it applies again.
      if (!e.archivedReason || g.complete) out.keep.push(e.key);
      else out.update.push({ key: e.key, taskId: e.taskId, titleEn: g.titleEn, titleAr: g.titleAr, priority: g.priority, dueAt: g.dueDate, generatedDueAt: g.dueDate, dateLocked: false, status: "TODO" });
      continue;
    }
    const locked = e.dateLocked || (!!e.generatedDueAt && !sameDay(e.dueAt, e.generatedDueAt));
    out.update.push({
      key: e.key,
      taskId: e.taskId,
      titleEn: g.titleEn,
      titleAr: g.titleAr,
      priority: g.priority,
      dueAt: locked ? e.dueAt : g.dueDate,
      generatedDueAt: g.dueDate,
      dateLocked: locked,
      ...(g.complete ? { status: "DONE" as const } : {}),
    });
  }
  for (const e of existing) {
    if (seen.has(e.key) || e.status === "DONE" || e.status === "CANCELLED") continue;
    out.archive.push({ key: e.key, taskId: e.taskId, reason: archiveReason });
  }
  return out;
}
