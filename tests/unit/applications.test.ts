// Deadline resolver, urgency buckets, task planning and reconciliation, stage rules and checklists. Pure functions.
import { describe, expect, it } from "vitest";
import { primaryDeadline, resolveDeadlines, routeDefaults, urgencyFor, type DeadlineRowIn } from "@/server/applications/deadlines";
import { adaptLateStart, alignDependencies, generatePlan, reconcile, taskKey, type ExistingTask, type PlannedTask } from "@/server/applications/planner";
import { buildChecklist } from "@/server/applications/checklist";
import { canTransition, intakeYearFor, nextStages, routeFor } from "@/server/applications/types";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const day = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;

describe("deadline resolver", () => {
  const base = { programId: "p1", universityId: "u1", intakeYear: 2027, route: "UCAS" as const };
  const row = (r: Partial<DeadlineRowIn>): DeadlineRowIn => ({ programId: null, universityId: null, intakeYear: 2027, kind: "UCAS_EQUAL", date: d("2027-01-14"), orgId: null, ...r });

  it("uses the programme row before the university row before the route default", () => {
    const rows = [row({ universityId: "u1", date: d("2027-01-10") }), row({ programId: "p1", universityId: "u1", date: d("2027-01-05") })];
    const all = resolveDeadlines({ ...base, rows });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "UCAS_EQUAL", source: "PROGRAM", confirm: false });
    expect(day(all[0].date)).toBe("2027-01-05");

    const uniOnly = resolveDeadlines({ ...base, rows: [rows[0]] });
    expect(uniOnly[0]).toMatchObject({ source: "UNIVERSITY", confirm: false });
    expect(day(uniOnly[0].date)).toBe("2027-01-10");

    const none = resolveDeadlines({ ...base, rows: [] });
    expect(none[0]).toMatchObject({ kind: "UCAS_EQUAL", source: "ROUTE_DEFAULT", confirm: true });
    expect(day(none[0].date)).toBe("2027-01-14");
  });

  it("prefers the school's own row over a global row at the same level", () => {
    const all = resolveDeadlines({ ...base, rows: [row({ programId: "p1", date: d("2027-01-02") }), row({ programId: "p1", orgId: "org", date: d("2027-01-03") })] });
    expect(day(all[0].date)).toBe("2027-01-03");
  });

  it("ignores other intake years and other universities", () => {
    const all = resolveDeadlines({ ...base, rows: [row({ programId: "p1", intakeYear: 2026 }), row({ universityId: "u2" })] });
    expect(all.every((x) => x.source === "ROUTE_DEFAULT")).toBe(true);
  });

  it("keeps informational university rows next to route defaults", () => {
    const all = resolveDeadlines({ ...base, route: "UAE", rows: [row({ universityId: "u1", kind: "INTERVIEW", date: d("2026-10-20") })] });
    expect(all.map((x) => `${x.kind}:${x.source}`)).toEqual(["INTERVIEW:UNIVERSITY", "UAE_WINDOW:ROUTE_DEFAULT"]);
  });

  it("route defaults: Oxbridge and medicine in October, US early rounds 1 November, regular 1 January", () => {
    expect(routeDefaults("UCAS", 2027, { oxbridgeOrMedicine: true }).map((x) => `${x.kind} ${day(x.date)}`)).toEqual(["OXBRIDGE_MEDICINE 2026-10-15"]);
    expect(routeDefaults("COMMON_APP", 2027).map((x) => `${x.kind} ${day(x.date)}`)).toEqual(["ED 2026-11-01", "EA 2026-11-01", "RD 2027-01-01"]);
    expect(routeDefaults("OUAC", 2027)[0].kind).toBe("OUAC_EQUAL");
    expect(routeDefaults("JORDAN_UNIFIED", 2027)[0].kind).toBe("UNIFIED");
    expect(routeDefaults("DIRECT", 2027)).toEqual([]);
    expect(routeDefaults("UAE", 2027).every((x) => x.confirm && x.source === "ROUTE_DEFAULT")).toBe(true);
  });

  it("primary deadline follows the decision plan, else the earliest one still ahead", () => {
    const all = routeDefaults("COMMON_APP", 2027);
    expect(primaryDeadline(all, "RD", d("2026-09-29"))?.kind).toBe("RD");
    expect(day(primaryDeadline(all, null, d("2026-09-29"))!.date)).toBe("2026-11-01");
    expect(primaryDeadline(all, null, d("2026-12-01"))?.kind).toBe("RD");
    expect(primaryDeadline(all, null, d("2027-03-01"))?.kind).toBe("RD");
  });
});

describe("urgency buckets", () => {
  const today = d("2026-09-29");
  it.each([
    ["2026-09-20", "overdue", "URGENT"],
    ["2026-09-29", "urgent", "URGENT"],
    ["2026-10-13", "urgent", "URGENT"],
    ["2026-10-14", "soon", "HIGH"],
    ["2026-10-29", "soon", "HIGH"],
    ["2026-10-30", "upcoming", "MEDIUM"],
    ["2026-12-28", "upcoming", "MEDIUM"],
    ["2026-12-29", "later", "LOW"],
  ])("%s is %s", (due, bucket, priority) => {
    expect(urgencyFor(d(due), today)).toMatchObject({ bucket, priority });
  });
  it("no date", () => expect(urgencyFor(null, today)).toMatchObject({ bucket: "none", days: null }));
});

const items = [
  { id: "form", kind: "FORM" as const, titleEn: "Submit", titleAr: "تقديم", status: "TODO" },
  { id: "ps", kind: "PERSONAL_STATEMENT" as const, titleEn: "Statement", titleAr: "مقال", status: "TODO" },
  { id: "essay", kind: "ESSAY" as const, titleEn: "Essay", titleAr: "مقال", status: "TODO" },
  { id: "test", kind: "TEST" as const, titleEn: "SAT", titleAr: "SAT", status: "TODO" },
  { id: "int", kind: "INTERVIEW" as const, titleEn: "Interview", titleAr: "مقابلة", status: "TODO" },
];

describe("task plan", () => {
  it("counts back from the deadline when there is time", () => {
    const plan = generatePlan({ applicationId: "a", cycle: 2027, items, deadline: d("2027-01-14"), today: d("2026-09-01") });
    const by = (id: string) => plan.find((t) => t.itemId === id)!;
    expect(day(by("test").dueDate)).toBe("2026-11-15");
    expect(day(by("ps").dueDate)).toBe("2026-12-17");
    expect(day(by("form").dueDate)).toBe("2027-01-14");
    expect(day(by("int").dueDate)).toBe("2027-02-04");
    expect(by("test").flags).toEqual([]);
    expect(by("form").key).toBe(taskKey("a", "form", 2027, "student"));
    expect(by("form").dependencies).toEqual(expect.arrayContaining([by("ps").key, by("essay").key, by("test").key]));
  });

  it("a late start compresses the plan proportionally and never moves the deadline", () => {
    // Ideal span: test at -60 days is the earliest; today is 30 days before the deadline.
    const plan = generatePlan({ applicationId: "a", cycle: 2027, items, deadline: d("2026-10-29"), today: d("2026-09-29") });
    const by = (id: string) => plan.find((t) => t.itemId === id)!;
    expect(day(by("test").dueDate)).toBe("2026-09-29"); // start of the ideal span maps to today
    expect(day(by("ps").dueDate)).toBe("2026-10-15"); // -28 of 60 days: 32/60 through, 16 of 30 days
    expect(day(by("essay").dueDate)).toBe("2026-10-18"); // -21: 39/60 through, 19.5 days rounds up
    expect(day(by("form").dueDate)).toBe("2026-10-29");
    expect(by("ps").flags).toContain("late_start");
    expect(by("form").flags).not.toContain("late_start");
    // Every compressed date stays in [today, deadline - 1].
    for (const t of plan.filter((x) => x.offsetDays < 0)) {
      expect(t.dueDate!.getTime()).toBeGreaterThanOrEqual(d("2026-09-29").getTime() - 12 * 3600_000);
      expect(t.dueDate!.getTime()).toBeLessThan(d("2026-10-29").getTime());
    }
  });

  it("marks work that cannot fit as not feasible", () => {
    const tasks: PlannedTask[] = [{ key: "k", itemId: "i", kind: "TEST", role: "student", titleEn: "", titleAr: "", idealDate: d("2026-08-01"), dueDate: d("2026-08-01"), offsetDays: -60, priority: "LOW", flags: [], dependencies: [], complete: false }];
    // Deadline tomorrow: the only slot is today.
    adaptLateStart(tasks, new Date(Date.UTC(2026, 8, 29)), new Date(Date.UTC(2026, 8, 30)));
    expect(tasks[0].flags).toContain("late_start");
    expect(day(tasks[0].dueDate)).toBe("2026-09-29");
  });

  it("aligns tasks after their prerequisites and flags a fixed date that would have to move", () => {
    const mk = (key: string, due: string, offsetDays: number, deps: string[] = []): PlannedTask => ({ key, itemId: key, kind: "ESSAY", role: "student", titleEn: key, titleAr: key, idealDate: d(due), dueDate: d(due), offsetDays, priority: "LOW", flags: [], dependencies: deps, complete: false });
    const test = mk("test", "2026-12-01", -30);
    const essay = mk("essay", "2026-11-20", -21, ["test"]);
    const form = mk("form", "2026-11-25", 0, ["essay", "test"]);
    alignDependencies([test, essay, form]);
    expect(day(essay.dueDate)).toBe("2026-12-01");
    expect(essay.flags).toContain("after_prerequisite");
    expect(day(form.dueDate)).toBe("2026-11-25");
    expect(form.flags).toContain("dependency_conflict");
    expect(form.priority).toBe("URGENT");
  });

  it("completed dependencies do not hold work back", () => {
    const plan = generatePlan({ applicationId: "a", cycle: 2027, items: [{ ...items[1], status: "DONE" }, items[2]], deadline: d("2027-01-14"), today: d("2026-09-01") });
    expect(plan.find((t) => t.itemId === "essay")!.flags).not.toContain("after_prerequisite");
    expect(plan.find((t) => t.itemId === "ps")!.complete).toBe(true);
  });

  it("without a deadline, tasks need a date", () => {
    const plan = generatePlan({ applicationId: "a", cycle: 2027, items, deadline: null, today: d("2026-09-01") });
    expect(plan.every((t) => t.dueDate === null && t.flags.includes("needs_date"))).toBe(true);
  });

  it("an assigned recommendation completes the counselor's assignment step", () => {
    const plan = generatePlan({ applicationId: "a", cycle: 2027, items: [{ id: "r", kind: "RECOMMENDATION", titleEn: "Ref", titleAr: "مرجع", status: "IN_PROGRESS", assigned: true }], deadline: d("2027-01-14"), today: d("2026-09-01") });
    expect(plan[0]).toMatchObject({ role: "counselor", complete: true });
  });
});

describe("reconcile", () => {
  const gen = (key: string, due: string, complete = false): PlannedTask => ({ key, itemId: key, kind: "ESSAY", role: "student", titleEn: `T ${key}`, titleAr: key, idealDate: d(due), dueDate: d(due), offsetDays: -10, priority: "MEDIUM", flags: [], dependencies: [], complete });
  const ex = (key: string, over: Partial<ExistingTask> = {}): ExistingTask => ({ key, taskId: `t-${key}`, status: "TODO", dueAt: d("2026-10-01"), generatedDueAt: d("2026-10-01"), dateLocked: false, archivedReason: null, ...over });

  it("creates new tasks once and updates existing ones in place", () => {
    const r = reconcile([gen("a", "2026-10-05"), gen("b", "2026-10-06")], [ex("a")]);
    expect(r.create.map((t) => t.key)).toEqual(["b"]);
    expect(r.update).toHaveLength(1);
    expect(day(r.update[0].dueAt)).toBe("2026-10-05");
  });

  it("keeps completed tasks untouched", () => {
    const r = reconcile([gen("a", "2026-10-05")], [ex("a", { status: "DONE" })]);
    expect(r.keep).toEqual(["a"]);
    expect(r.update).toEqual([]);
  });

  it("keeps locked and hand-edited dates", () => {
    const locked = reconcile([gen("a", "2026-10-05")], [ex("a", { dateLocked: true })]);
    expect(day(locked.update[0].dueAt)).toBe("2026-10-01");
    const edited = reconcile([gen("a", "2026-10-05")], [ex("a", { dueAt: d("2026-10-09"), generatedDueAt: d("2026-10-01") })]);
    expect(day(edited.update[0].dueAt)).toBe("2026-10-09");
    expect(edited.update[0].dateLocked).toBe(true);
    expect(day(edited.update[0].generatedDueAt)).toBe("2026-10-05");
  });

  it("archives tasks that no longer apply, with a reason", () => {
    const r = reconcile([], [ex("a"), ex("b", { status: "DONE" }), ex("c", { status: "CANCELLED" })], "Application submitted");
    expect(r.archive).toEqual([{ key: "a", taskId: "t-a", reason: "Application submitted" }]);
  });

  it("brings back a system-archived task, but not one a person cancelled", () => {
    const r = reconcile([gen("a", "2026-10-05"), gen("b", "2026-10-05")], [ex("a", { status: "CANCELLED", archivedReason: "x" }), ex("b", { status: "CANCELLED" })]);
    expect(r.update.map((u) => [u.key, u.status])).toEqual([["a", "TODO"]]);
    expect(r.keep).toEqual(["b"]);
  });

  it("completes the task when its item is done, and never creates one for a done item", () => {
    const r = reconcile([gen("a", "2026-10-05", true), gen("b", "2026-10-05", true)], [ex("a")]);
    expect(r.update[0].status).toBe("DONE");
    expect(r.create).toEqual([]);
  });
});

describe("stage transitions", () => {
  it("allows the normal pipeline and refuses jumps", () => {
    expect(canTransition("PREPARING", "SUBMITTED", "staff")).toBe(true);
    expect(canTransition("SUBMITTED", "OFFER", "staff")).toBe(true);
    expect(canTransition("OFFER", "ACCEPTED", "staff")).toBe(true);
    expect(canTransition("ACCEPTED", "ENROLLED", "staff")).toBe(true);
    expect(canTransition("PREPARING", "OFFER", "staff")).toBe(false);
    expect(canTransition("RESEARCHING", "ENROLLED", "staff")).toBe(false);
    expect(canTransition("REJECTED", "OFFER", "staff")).toBe(false);
    expect(canTransition("OFFER", "OFFER", "staff")).toBe(false);
  });
  it("students move their own application up to submitted, never decisions", () => {
    expect(canTransition("PREPARING", "SUBMITTED", "student")).toBe(true);
    expect(canTransition("SUBMITTED", "OFFER", "student")).toBe(false);
    expect(canTransition("SUBMITTED", "PREPARING", "student")).toBe(false);
    expect(nextStages("SUBMITTED", "student")).toEqual([]);
    expect(nextStages("SUBMITTED", "staff")).toEqual(["PREPARING", "INTERVIEW", "OFFER", "REJECTED", "WAITLISTED"]);
  });
});

describe("routes, intake and checklist", () => {
  it("resolves the route", () => {
    expect(routeFor("UCAS", "GB")).toBe("UCAS");
    expect(routeFor("DIRECT", "AE")).toBe("UAE");
    expect(routeFor(null, "US")).toBe("COMMON_APP");
    expect(routeFor("DIRECT", "DE")).toBe("DIRECT");
  });
  it("Grade 12 in the autumn applies for next year", () => {
    expect(intakeYearFor(12, d("2026-09-29"))).toBe(2027);
    expect(intakeYearFor(12, d("2027-02-01"))).toBe(2027);
    expect(intakeYearFor(9, d("2026-09-29"))).toBe(2030);
  });
  it("builds the checklist from the route and current requirement rows, without duplicates", () => {
    const list = buildChecklist({
      route: "COMMON_APP",
      current: {
        tests: [{ test: "SAT", policy: "REQUIRED" }, { test: "ACT", policy: "REQUIRED" }, { test: "AP", policy: "BLIND" }],
        languages: [{ test: "TOEFL", minOverall: 100 }, { test: "IELTS", minOverall: 7 }],
        additional: [{ kind: "PORTFOLIO", required: true, noteEn: "Portfolio of work", noteAr: "ملف أعمال" }, { kind: "INTERVIEW", required: false }],
      },
    });
    const kinds = list.map((i) => i.kind);
    expect(kinds.filter((k) => k === "TEST")).toHaveLength(1);
    expect(list.find((i) => i.kind === "LANGUAGE_TEST")?.titleEn).toBe("IELTS 7 or equivalent");
    expect(kinds).toContain("PORTFOLIO");
    expect(kinds).not.toContain("INTERVIEW");
    expect(kinds.filter((k) => k === "RECOMMENDATION")).toHaveLength(2);
    expect(kinds[kinds.length - 1]).toBe("FORM");
    expect(list.every((i) => i.titleAr.length > 0)).toBe(true);
  });
  it("falls back to the older programme data, and adds an interview for Oxbridge and medicine", () => {
    const list = buildChecklist({ route: "UCAS", oxbridgeOrMedicine: true, legacy: { admissionsTests: ["TMUA"], ielts: 7.5 } });
    expect(list.map((i) => i.titleEn)).toEqual(expect.arrayContaining(["TMUA admissions test", "IELTS 7.5 or equivalent", "Admissions interview", "UCAS personal statement"]));
  });
});
