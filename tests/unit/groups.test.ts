import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aggregateGroupKpis, avgTurnaround, type SchoolKpis } from "@/server/groups/kpis";
import { generateGroupCode, groupInviteState, hashGroupCode, normalizeGroupCode } from "@/server/groups/codes";
import { freeKey, portableGraph } from "@/server/groups/push";
import { groupAggregatePolicy } from "@/server/access/case-access";
import type { WorkflowGraph } from "@/server/workflows/graph";

function school(over: Partial<SchoolKpis>): SchoolKpis {
  return {
    orgId: "o",
    students: 0,
    openRequests: 0,
    closedRequests: 0,
    turnaroundHoursTotal: 0,
    overdueRequests: 0,
    overdueTasks: 0,
    parentMeetingsHeld: 0,
    parentMeetingsUpcoming: 0,
    requestsSubmitted: 0,
    serviceUsage: [],
    onboarding: { done: 0, total: 6, completed: false },
    activeUsers: 0,
    accounts: 0,
    plansApproved: 0,
    plansProposed: 0,
    applications: {},
    ...over,
  };
}

describe("group KPI aggregation", () => {
  it("sums counts across schools", () => {
    const t = aggregateGroupKpis([
      school({ orgId: "a", students: 100, openRequests: 7, overdueRequests: 2, overdueTasks: 1, parentMeetingsHeld: 5, parentMeetingsUpcoming: 3, activeUsers: 40, accounts: 60, plansApproved: 4, plansProposed: 1 }),
      school({ orgId: "b", students: 20, openRequests: 3, overdueRequests: 0, overdueTasks: 4, parentMeetingsHeld: 1, parentMeetingsUpcoming: 2, activeUsers: 10, accounts: 25, plansApproved: 0, plansProposed: 2 }),
    ]);
    expect(t.schools).toBe(2);
    expect(t.students).toBe(120);
    expect(t.openRequests).toBe(10);
    expect(t.overdue).toBe(7);
    expect(t.overdueRequests).toBe(2);
    expect(t.overdueTasks).toBe(5);
    expect(t.parentMeetingsHeld).toBe(6);
    expect(t.parentMeetingsUpcoming).toBe(5);
    expect(t.activeUsers).toBe(50);
    expect(t.accounts).toBe(85);
    expect(t.plansApproved).toBe(4);
    expect(t.plansProposed).toBe(3);
  });

  it("weights turnaround by completed requests instead of averaging school averages", () => {
    // School a: 10 requests in 100 h total (10 h each). School b: 1 request in 50 h.
    const a = school({ orgId: "a", closedRequests: 10, turnaroundHoursTotal: 100 });
    const b = school({ orgId: "b", closedRequests: 1, turnaroundHoursTotal: 50 });
    expect(avgTurnaround(a)).toBe(10);
    expect(avgTurnaround(b)).toBe(50);
    expect(aggregateGroupKpis([a, b]).avgTurnaroundHours).toBe(13.6); // 150 / 11, not (10 + 50) / 2
  });

  it("has no turnaround when nothing was completed", () => {
    expect(avgTurnaround(school({}))).toBeNull();
    expect(aggregateGroupKpis([school({}), school({})]).avgTurnaroundHours).toBeNull();
    expect(aggregateGroupKpis([]).avgTurnaroundHours).toBeNull();
  });

  it("merges service usage by service key and keeps the top ones", () => {
    const t = aggregateGroupKpis(
      [
        school({ serviceUsage: [{ key: "document_request", nameEn: "Documents", nameAr: "وثائق", count: 5 }, { key: "it_support", nameEn: "IT", nameAr: "تقنية", count: 1 }] }),
        school({ serviceUsage: [{ key: "document_request", nameEn: "Letters", nameAr: "خطابات", count: 2 }, { key: "absence_request", nameEn: "Absence", nameAr: "غياب", count: 3 }] }),
      ],
      { topServices: 2 },
    );
    expect(t.serviceUsage.map((s) => [s.key, s.count])).toEqual([
      ["document_request", 7],
      ["absence_request", 3],
    ]);
  });

  it("adds applications by stage and counts finished setups", () => {
    const t = aggregateGroupKpis([
      school({ applications: { SUBMITTED: 3, OFFER: 1 }, onboarding: { done: 6, total: 6, completed: true } }),
      school({ applications: { SUBMITTED: 2, REJECTED: 1 }, onboarding: { done: 3, total: 6, completed: false } }),
    ]);
    expect(t.applications.SUBMITTED).toBe(5);
    expect(t.applications.OFFER).toBe(1);
    expect(t.applications.REJECTED).toBe(1);
    expect(t.applications.ENROLLED).toBe(0);
    expect(t.applicationsTotal).toBe(7);
    expect(t.onboardingCompleted).toBe(1);
  });

  it("allows no case figures and only standard requests at group level", () => {
    const p = groupAggregatePolicy();
    expect(p.cases).toBe(false);
    expect(p.requestSensitivities).toEqual(["STANDARD"]);
    expect(p.taskSensitivities).toEqual(["STANDARD"]);
  });
});

describe("group invite codes", () => {
  it("generates readable codes that normalize and hash consistently", () => {
    const code = generateGroupCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const n = normalizeGroupCode(` ${code.toLowerCase().replace("-", " - ")} `);
    expect(n).toBe(code.replace("-", ""));
    expect(hashGroupCode(n!)).toBe(hashGroupCode(normalizeGroupCode(code)!));
    expect(normalizeGroupCode("short")).toBeNull();
    expect(normalizeGroupCode("ABCDE-0OOOO")).toBeNull(); // 0 and O are not in the alphabet
  });

  it("knows when a code can still be used", () => {
    const now = new Date("2026-10-06T10:00:00Z");
    const later = new Date("2026-10-20T10:00:00Z");
    expect(groupInviteState({ usedAt: null, revokedAt: null, expiresAt: later }, now)).toBe("OPEN");
    expect(groupInviteState({ usedAt: now, revokedAt: null, expiresAt: later }, now)).toBe("USED");
    expect(groupInviteState({ usedAt: null, revokedAt: now, expiresAt: later }, now)).toBe("REVOKED");
    expect(groupInviteState({ usedAt: null, revokedAt: null, expiresAt: now }, now)).toBe("EXPIRED");
  });
});

describe("template push helpers", () => {
  it("finds a free key", () => {
    expect(freeKey("enrollment", [])).toBe("enrollment");
    expect(freeKey("enrollment", ["enrollment", "enrollment_2"])).toBe("enrollment_3");
  });

  it("sends steps aimed at a named person to the school administrator role", () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "a", type: "approval", position: { x: 0, y: 0 }, data: { label: { en: "A", ar: "أ" }, approvers: [{ assignee: { kind: "member", membershipId: "m1" }, label: { en: "x", ar: "س" } }, { assignee: { kind: "role", role: "principal" }, label: { en: "y", ar: "ص" } }] } },
        { id: "t", type: "task", position: { x: 0, y: 0 }, data: { label: { en: "T", ar: "ت" }, assignee: { kind: "member", membershipId: "m2" } } },
        { id: "n", type: "notify", position: { x: 0, y: 0 }, data: { label: { en: "N", ar: "ن" }, recipients: [{ kind: "requester" }] } },
      ],
      edges: [],
    };
    const { graph: out, replaced } = portableGraph(graph);
    expect(replaced).toBe(2);
    expect(out.nodes[0].data.approvers?.map((a) => a.assignee)).toEqual([{ kind: "role", role: "school_admin" }, { kind: "role", role: "principal" }]);
    expect(out.nodes[1].data.assignee).toEqual({ kind: "role", role: "school_admin" });
    expect(out.nodes[2].data.recipients).toEqual([{ kind: "requester" }]);
    // The source graph is not changed.
    expect(graph.nodes[1].data.assignee).toEqual({ kind: "member", membershipId: "m2" });
  });
});
