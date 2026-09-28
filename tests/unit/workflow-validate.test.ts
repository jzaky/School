import { describe, expect, it } from "vitest";
import { WORKFLOW_TEMPLATES } from "../../prisma/seed/data/workflows";
import type { WorkflowGraph } from "@/server/workflows/graph";
import { parseGraph, validateGraph } from "@/server/workflows/validate";
import { simulate } from "@/server/workflows/simulate";
import { layoutGraph } from "@/server/workflows/layout";
import { draftWorkflowFromText } from "@/server/workflows/draft";

const clone = (g: WorkflowGraph): WorkflowGraph => JSON.parse(JSON.stringify(g));
const codes = (g: WorkflowGraph, opts?: { safeguarding?: boolean }) => validateGraph(g, opts).map((i) => i.code);
const tpl = (key: string) => clone(WORKFLOW_TEMPLATES.find((t) => t.key === key)!.graph);

function linear(): WorkflowGraph {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: { en: "Start", ar: "البداية" } } },
      { id: "end", type: "end", position: { x: 0, y: 0 }, data: { label: { en: "Done", ar: "تم" }, outcome: "COMPLETED" } },
    ],
    edges: [{ id: "e1", source: "start", target: "end" }],
  };
}

describe("validateGraph", () => {
  it.each(WORKFLOW_TEMPLATES.map((t) => [t.key, t]))("seeded workflow %s passes", (key, t) => {
    expect(validateGraph(t.graph, { safeguarding: key === "safeguarding_concern" })).toEqual([]);
  });

  it("accepts the minimal start to end workflow", () => {
    expect(codes(linear())).toEqual([]);
  });

  it("requires exactly one start and a reachable end", () => {
    const g = linear();
    g.nodes.push({ id: "start2", type: "start", position: { x: 0, y: 0 }, data: { label: { en: "S", ar: "ب" } } });
    g.edges.push({ id: "e2", source: "start2", target: "end" });
    expect(codes(g)).toContain("multiple_start");

    const noStart = linear();
    noStart.nodes = noStart.nodes.filter((n) => n.type !== "start");
    noStart.edges = [];
    expect(codes(noStart)).toContain("no_start");

    const cut = linear();
    cut.edges = [];
    expect(codes(cut)).toEqual(expect.arrayContaining(["end_unreachable", "dead_end", "unreachable"]));
  });

  it("flags dangling, duplicate and wrongly labelled edges", () => {
    const g = linear();
    g.edges.push({ id: "e2", source: "start", target: "ghost" });
    g.edges.push({ id: "e3", source: "start", target: "end" });
    g.edges.push({ id: "e4", source: "start", target: "end", sourceHandle: "approved" });
    const c = codes(g);
    expect(c).toContain("dangling_edge");
    expect(c).toContain("duplicate_edge");
    expect(c).toContain("bad_handle");
  });

  it("requires both branches of condition and approval nodes", () => {
    const g = tpl("behavioral_referral");
    g.edges = g.edges.filter((e) => !(e.source === "serious" && e.sourceHandle === "false"));
    expect(codes(g)).toContain("missing_branch_false");

    const a = tpl("document_request");
    a.edges = a.edges.filter((e) => e.sourceHandle !== "rejected");
    expect(codes(a)).toEqual(expect.arrayContaining(["missing_branch_rejected", "unreachable"]));
  });

  it("requires config per node type", () => {
    const g = tpl("subject_change");
    g.nodes.find((n) => n.id === "registrar")!.data.approvers = [];
    g.nodes.find((n) => n.id === "notify")!.data.template = undefined;
    g.nodes.find((n) => n.id === "status")!.data.label = { en: "Timetable updated", ar: "" };
    const c = validateGraph(g);
    expect(c).toContainEqual({ code: "no_approvers", nodeId: "registrar" });
    expect(c).toContainEqual({ code: "missing_template", nodeId: "notify" });
    expect(c).toContainEqual({ code: "missing_label", nodeId: "status" });

    const w = tpl("academic_concern");
    w.nodes.find((n) => n.id === "wait_followup")!.data.hours = 0;
    w.nodes.find((n) => n.id === "plan_task")!.data.assignee = { kind: "role", role: "" };
    expect(codes(w)).toEqual(expect.arrayContaining(["missing_hours", "missing_assignee"]));

    const cond = tpl("behavioral_referral");
    cond.nodes.find((n) => n.id === "serious")!.data.condition = { field: "form.urgency", op: "eq", value: "" };
    expect(codes(cond)).toContain("missing_value");
  });

  it("rejects cycles", () => {
    const g = tpl("it_support");
    g.edges.push({ id: "loop", source: "notify", target: "task" });
    expect(codes(g)).toContain("cycle");
  });

  it("keeps safeguarding routing with the DSL", () => {
    const g = tpl("safeguarding_concern");
    g.nodes.find((n) => n.id === "case")!.data.assignee = { kind: "role", role: "counselor" };
    expect(codes(g, { safeguarding: true })).toContain("sg_routing");
    // The same change is fine for a workflow that does not serve a safeguarding service.
    expect(codes(g)).toEqual([]);

    const fam = tpl("safeguarding_concern");
    fam.nodes.find((n) => n.id === "alert")!.data.recipients = [{ kind: "guardians" }];
    expect(codes(fam, { safeguarding: true })).toContain("sg_family_notified");

    const ap = tpl("safeguarding_concern");
    ap.nodes.push({
      id: "ok",
      type: "approval",
      position: { x: 0, y: 0 },
      data: { label: { en: "Sign off", ar: "اعتماد" }, mode: "PARALLEL_ANY", approvers: [{ assignee: { kind: "role", role: "principal" }, label: { en: "Principal", ar: "المدير" } }] },
    });
    ap.edges = ap.edges.filter((e) => !(e.source === "review" && e.target === "end"));
    ap.edges.push({ id: "x1", source: "review", target: "ok" }, { id: "x2", source: "ok", target: "end", sourceHandle: "approved" }, { id: "x3", source: "ok", target: "end", sourceHandle: "rejected" });
    expect(validateGraph(ap, { safeguarding: true })).toContainEqual({ code: "sg_routing", nodeId: "ok" });

    const noCase = tpl("safeguarding_concern");
    noCase.nodes = noCase.nodes.filter((n) => n.id !== "case");
    noCase.edges = noCase.edges.filter((e) => e.source !== "case" && e.target !== "case");
    noCase.edges.push({ id: "y", source: "start", target: "danger" });
    expect(codes(noCase, { safeguarding: true })).toContain("sg_no_case");
  });
});

describe("parseGraph", () => {
  it("strips UI fields and rejects bad shapes", () => {
    const g = parseGraph({ nodes: [{ id: "start", type: "start", position: { x: 1, y: 2 }, selected: true, data: { label: { en: "A", ar: "ب" } } }], edges: [] });
    expect(g?.nodes[0]).toEqual({ id: "start", type: "start", position: { x: 1, y: 2 }, data: { label: { en: "A", ar: "ب" } } });
    expect(parseGraph({ nodes: [{ id: "x", type: "rocket", data: {} }], edges: [] })).toBeNull();
    expect(parseGraph("nope")).toBeNull();
  });
});

describe("simulate", () => {
  it("follows chosen approval outcomes", () => {
    const g = tpl("document_request");
    const ok = simulate(g, {});
    expect(ok.outcome).toBe("COMPLETED");
    expect([...ok.nodeIds]).toEqual(["start", "registrar", "generate", "notify", "end"]);
    const no = simulate(g, { registrar: "rejected" });
    expect(no.outcome).toBe("REJECTED");
    expect(no.nodeIds.has("generate")).toBe(false);
  });

  it("follows condition branches", () => {
    const g = tpl("safeguarding_concern");
    expect(simulate(g, { danger: "true" }).nodeIds.has("alert_all")).toBe(true);
    expect(simulate(g, { danger: "false" }).nodeIds.has("alert_all")).toBe(false);
  });
});

describe("layout and AI fallback", () => {
  it("lays out top to bottom", () => {
    const g = layoutGraph(tpl("subject_change"));
    const y = (id: string) => g.nodes.find((n) => n.id === id)!.position.y;
    expect(y("start")).toBeLessThan(y("parent"));
    expect(y("parent")).toBeLessThan(y("academic"));
    expect(y("end")).toBe(y("end_rejected"));
  });

  it("drafts valid workflows from keywords", () => {
    const a = draftWorkflowFromText("Parent consent, then the principal signs off, then issue a letter", { documentTemplateKey: "enrollment_letter" });
    expect(validateGraph(a)).toEqual([]);
    expect(a.nodes.filter((n) => n.type === "approval").map((n) => n.data.approvers![0].assignee)).toEqual([{ kind: "guardians" }, { kind: "role", role: "principal" }]);
    expect(a.nodes.some((n) => n.type === "generate_document")).toBe(true);

    const b = draftWorkflowFromText("طلب يحتاج موافقة ولي الأمر ثم المسجل");
    expect(validateGraph(b)).toEqual([]);
    expect(b.nodes.filter((n) => n.type === "approval")).toHaveLength(2);

    const c = draftWorkflowFromText("something vague");
    expect(validateGraph(c)).toEqual([]);

    const d = draftWorkflowFromText("Laptop repair handled by IT support");
    expect(validateGraph(d)).toEqual([]);
    expect(d.nodes.some((n) => n.type === "task")).toBe(true);
  });
});
