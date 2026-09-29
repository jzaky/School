import { describe, expect, it } from "vitest";
import { allocateGroup, letterAt, nextSectionLetter, type AllocRequest, type AllocSection } from "@/server/registration/allocate";
import { checkChoices, type OfferingLite } from "@/lib/registration";

const req = (n: number, extra: Partial<AllocRequest> = {}): AllocRequest => ({ registrationId: `r${n}`, studentId: `s${n}`, classId: null, active: true, status: "REQUESTED", ...extra });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Apply a result to the sections, as the database layer does. */
function apply(sections: AllocSection[], requests: AllocRequest[], res: ReturnType<typeof allocateGroup>) {
  const all = [...sections.map((s) => ({ ...s, members: [...s.members] })), ...res.newSections.map((n) => ({ id: n.id, section: n.section, capacity: null, members: [] as string[] }))];
  for (const u of res.unenroll) {
    const s = all.find((x) => x.id === u.classId)!;
    s.members = s.members.filter((m) => m !== u.studentId);
  }
  for (const e of res.enroll) all.find((x) => x.id === e.classId)!.members.push(e.studentId);
  const nextReqs = requests.map((r) => {
    const u = res.updates.find((x) => x.registrationId === r.registrationId);
    return u ? { ...r, classId: u.classId, status: u.status } : r;
  });
  return { sections: all, requests: nextReqs };
}

describe("allocateGroup", () => {
  it("respects capacity and opens a new section when all are full", () => {
    const sections: AllocSection[] = [{ id: "c1", section: null, capacity: 3, members: [] }];
    const res = allocateGroup({ sections, requests: range(1, 5).map((n) => req(n)) });
    expect(res.newSections).toEqual([{ id: "new:B", section: "B" }]);
    const counts = new Map<string, number>();
    for (const p of res.placements) counts.set(p.classId, (counts.get(p.classId) ?? 0) + 1);
    expect(counts.get("c1")).toBe(3);
    expect(counts.get("new:B")).toBe(2);
    expect(res.updates.every((u) => u.status === "ALLOCATED")).toBe(true);
  });

  it("uses the default capacity of 24", () => {
    const res = allocateGroup({ sections: [{ id: "c1", section: "A", capacity: null, members: [] }], requests: range(1, 25).map((n) => req(n)) });
    expect(res.placements.filter((p) => p.classId === "c1")).toHaveLength(24);
    expect(res.newSections).toHaveLength(1);
  });

  it("balances new students across sections", () => {
    const sections: AllocSection[] = [
      { id: "a", section: "A", capacity: 10, members: ["x1", "x2", "x3", "x4"] },
      { id: "b", section: "B", capacity: 10, members: [] },
    ];
    // x1..x4 have no registration row here, so they stay and count as taken seats.
    const res = allocateGroup({ sections, requests: range(1, 6).map((n) => req(n)) });
    const inA = res.placements.filter((p) => p.classId === "a").length;
    const inB = res.placements.filter((p) => p.classId === "b").length;
    expect(inA + 4).toBe(5);
    expect(inB).toBe(5);
    expect(res.unenroll).toEqual([]);
  });

  it("keeps existing allocations stable even when a section is over capacity", () => {
    const sections: AllocSection[] = [
      { id: "a", section: "A", capacity: 2, members: ["s1", "s2", "s3"] },
      { id: "b", section: "B", capacity: 2, members: [] },
    ];
    const res = allocateGroup({ sections, requests: [req(1, { classId: "a", status: "ALLOCATED" }), req(2), req(3, { classId: "a", status: "ALLOCATED" }), req(4)] });
    expect(res.placements.find((p) => p.studentId === "s1")!.classId).toBe("a");
    expect(res.placements.find((p) => p.studentId === "s2")!.classId).toBe("a"); // adopted from the existing enrollment
    expect(res.placements.find((p) => p.studentId === "s3")!.classId).toBe("a");
    expect(res.placements.find((p) => p.studentId === "s4")!.classId).toBe("b");
    expect(res.unenroll).toEqual([]);
    expect(res.enroll).toEqual([{ studentId: "s4", classId: "b" }]);
  });

  it("is idempotent: a second run changes nothing", () => {
    const sections: AllocSection[] = [{ id: "a", section: null, capacity: 4, members: [] }];
    const requests = range(1, 9).map((n) => req(n));
    const first = allocateGroup({ sections, requests });
    const after = apply(sections, requests, first);
    const second = allocateGroup({ sections: after.sections.map((s) => ({ ...s, id: s.id })), requests: after.requests });
    expect(second.newSections).toEqual([]);
    expect(second.enroll).toEqual([]);
    expect(second.unenroll).toEqual([]);
    expect(second.updates).toEqual([]);
  });

  it("removes dropped students and places them nowhere", () => {
    const sections: AllocSection[] = [{ id: "a", section: "A", capacity: 5, members: ["s1", "s2", "legacy"] }];
    const res = allocateGroup({ sections, requests: [req(1, { classId: "a", status: "ALLOCATED" }), req(2, { classId: "a", status: "DROPPED", active: false })] });
    expect(res.unenroll).toEqual([{ studentId: "s2", classId: "a" }]);
    expect(res.updates).toEqual([{ registrationId: "r2", classId: null, status: "DROPPED" }]);
  });

  it("moves a student out of a section they no longer belong to", () => {
    const sections: AllocSection[] = [
      { id: "a", section: "A", capacity: 5, members: ["s1"] },
      { id: "b", section: "B", capacity: 5, members: ["s1"] },
    ];
    const res = allocateGroup({ sections, requests: [req(1, { classId: "b", status: "ALLOCATED" })] });
    expect(res.unenroll).toEqual([{ studentId: "s1", classId: "a" }]);
    expect(res.enroll).toEqual([]);
  });
});

describe("section letters", () => {
  it("counts letters", () => {
    expect(letterAt(0)).toBe("A");
    expect(letterAt(25)).toBe("Z");
    expect(letterAt(26)).toBe("AA");
    expect(nextSectionLetter([null])).toBe("B");
    expect(nextSectionLetter(["A", "C"])).toBe("D");
    expect(nextSectionLetter([])).toBe("A");
  });
});

describe("checkChoices", () => {
  const offerings: OfferingLite[] = [
    { subjectId: "math", code: "MATH", kind: "CORE", optionBlock: null, prerequisites: [] },
    { subjectId: "phys", code: "PHYS", kind: "OPTION", optionBlock: "A", prerequisites: ["MATH"] },
    { subjectId: "cs", code: "CS", kind: "OPTION", optionBlock: "A", prerequisites: [] },
    { subjectId: "chem", code: "CHEM", kind: "OPTION", optionBlock: "B", prerequisites: [] },
    { subjectId: "bio", code: "BIO", kind: "OPTION", optionBlock: "B", prerequisites: [] },
    { subjectId: "econ", code: "ECON", kind: "OPTION", optionBlock: "C", prerequisites: ["CHEM"] },
  ];
  it("accepts one option per block with prerequisites met", () => {
    expect(checkChoices(offerings, ["phys", "chem", "econ"])).toEqual([]);
  });
  it("flags missing blocks, two in a block, unknown subjects and prerequisites", () => {
    const errs = checkChoices(offerings, ["phys", "cs", "bio", "econ", "nope"]);
    expect(errs).toContainEqual({ code: "sameBlock", block: "A" });
    expect(errs).toContainEqual({ code: "notOffered", subjectId: "nope" });
    expect(errs).toContainEqual({ code: "prerequisite", subjectId: "econ", missing: ["CHEM"] });
    expect(checkChoices(offerings, ["cs"])).toContainEqual({ code: "missingBlock", block: "B" });
  });
  it("counts subjects taken in earlier years", () => {
    expect(checkChoices(offerings, ["cs", "bio", "econ"], new Set(["CHEM"]))).toEqual([]);
  });
});
