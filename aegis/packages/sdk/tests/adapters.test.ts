import { describe, expect, it } from "vitest";
import { AegisClient, AegisRefusal, aegisAnthropicToolUse, aegisLangChainTool, aegisOpenAIAgentsTool, aegisToolNode, guard, guardedCall, type Decision } from "../src/index.js";

/**
 * A stand-in for the AEGIS gateway HTTP API. Decides by the "amount" argument so each outcome can be
 * exercised, and records every call so tests can prove what happened in what order.
 */
function fakeGateway(opts: { down?: boolean; status500?: boolean; refuseStart?: boolean } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const reports: Record<string, unknown>[] = [];
  const decisions = new Map<string, Decision>();
  let n = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (opts.down) throw new Error("connect ECONNREFUSED");
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path, body });
    if (opts.status500) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
    if (path === "/v1/gateway/actions" && init?.method === "POST") {
      const prior = decisions.get(body.idempotencyKey);
      if (prior) return new Response(JSON.stringify({ ...prior, duplicate: true }), { status: 200 });
      const amount = Number(body.params.amount ?? 0);
      const id = `req-${++n}`;
      const base = { requestId: id, reasons: [], riskIndicators: [], policyVersionIds: [], matchedRuleIds: [], correlationId: id } as unknown as Decision;
      let d: Decision;
      if (amount <= 100) d = { ...base, status: "allowed", decision: "allow", grant: { token: `g-${id}`, expiresAt: "" } };
      else if (amount <= 200) d = { ...base, status: "allowed", decision: "restrict", grant: { token: `g-${id}`, expiresAt: "" }, restrictions: { applied: ["amount capped from X to 100"], params: { ...body.params, amount: 100 }, note: "" } };
      else if (amount <= 300) d = { ...base, status: "pending_approval", decision: "require_approval" };
      else if (amount <= 400) d = { ...base, status: "quarantined", decision: "quarantine", reasons: ["Suspicious"] };
      else if (amount <= 500) d = { ...base, status: "awaiting_information", decision: "request_more_information", moreInformation: { fields: ["ticketRef"], message: "", expiresAt: "" } };
      else d = { ...base, status: "denied", decision: "deny", reasons: ["Above the ceiling"] };
      decisions.set(body.idempotencyKey, d);
      const code = d.decision === "allow" || d.decision === "restrict" ? 200 : d.decision === "deny" ? 403 : 202;
      return new Response(JSON.stringify(d), { status: code });
    }
    if (path.endsWith("/start")) {
      if (opts.refuseStart) return new Response(JSON.stringify({ error: { message: "Grant cannot be used: gateway_paused" } }), { status: 409 });
      return new Response(JSON.stringify({ started: true }), { status: 200 });
    }
    if (path.endsWith("/execute")) {
      reports.push(body);
      return new Response(JSON.stringify({ status: body.outcome }), { status: 200 });
    }
    if (path.startsWith("/v1/gateway/actions/") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ status: "approved", receipts: [] }), { status: 200 });
    if (path.endsWith("/grant")) return new Response(JSON.stringify({ grant: "g-approved", expiresAt: "", requestHash: "h" }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { client: new AegisClient({ baseUrl: "https://aegis.test", apiKey: "aegis_ak_test", fetchImpl }), calls, reports };
}

describe("guardedCall", () => {
  it("runs the tool on allow and reports the outcome", async () => {
    const g = fakeGateway();
    let ran = 0;
    const out = await guardedCall(g.client, "issue-refund", { amount: 50 }, () => ++ran);
    expect(out.decision.decision).toBe("allow");
    expect(ran).toBe(1);
    expect(g.reports).toEqual([{ grant: "g-req-1", outcome: "succeeded", reference: null, summary: {} }]);
  });
  it("consumes the grant before the tool runs, and never runs it when the start is refused", async () => {
    const ok = fakeGateway();
    const order: string[] = [];
    await guardedCall(ok.client, "issue-refund", { amount: 50 }, () => order.push(`run after ${ok.calls.map((c) => c.path.split("/").pop()).join(",")}`));
    expect(order).toEqual(["run after actions,start"]);
    const paused = fakeGateway({ refuseStart: true });
    let ran = 0;
    const err = await guardedCall(paused.client, "issue-refund", { amount: 50 }, () => ++ran).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AegisRefusal);
    expect((err as Error).message).toMatch(/gateway_paused/);
    expect(ran).toBe(0);
    expect(paused.reports).toHaveLength(0);
  });
  it("runs the tool with the gateway's narrowed parameters on restrict", async () => {
    const g = fakeGateway();
    const seen: unknown[] = [];
    await guardedCall(g.client, "issue-refund", { amount: 180, orderId: "O1" }, (p) => seen.push(p));
    expect(seen).toEqual([{ amount: 100, orderId: "O1" }]);
  });
  it.each([
    [250, "require_approval", /approval/],
    [350, "quarantine", /security review/],
    [450, "request_more_information", /ticketRef/],
    [900, "deny", /Above the ceiling/],
  ])("never runs the tool when the decision is %s (%s)", async (amount, decision, message) => {
    const g = fakeGateway();
    let ran = 0;
    const err = await guardedCall(g.client, "t", { amount }, () => ++ran).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AegisRefusal);
    expect((err as AegisRefusal).decision.decision).toBe(decision);
    expect((err as Error).message).toMatch(message);
    expect(ran).toBe(0);
    expect(g.reports).toHaveLength(0);
  });
  it("fails closed when the gateway is unreachable or errors", async () => {
    for (const g of [fakeGateway({ down: true }), fakeGateway({ status500: true })]) {
      let ran = 0;
      const err = await guardedCall(g.client, "t", { amount: 1 }, () => ++ran).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AegisRefusal);
      expect((err as AegisRefusal).decision.decision).toBe("deny");
      expect((err as AegisRefusal).decision.transportError).toBeTruthy();
      expect(ran).toBe(0);
    }
  });
  it("fails closed when the gateway hangs past the timeout or answers with something that is not a decision", async () => {
    const hanging = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const garbled = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    const notADecision = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    for (const fetchImpl of [hanging, garbled, notADecision]) {
      const client = new AegisClient({ baseUrl: "http://gateway.test", apiKey: "k", fetchImpl, timeoutMs: 50 });
      let ran = 0;
      const err = await guardedCall(client, "t", { amount: 1 }, () => ++ran).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AegisRefusal);
      expect((err as AegisRefusal).decision.decision).toBe("deny");
      expect(ran).toBe(0);
    }
  });
  it("waits for a human when asked, then runs with the issued grant", async () => {
    const g = fakeGateway();
    let ran = 0;
    await guardedCall(g.client, "t", { amount: 250 }, () => ++ran, { waitForApproval: { timeoutMs: 1000, intervalMs: 10 } });
    expect(ran).toBe(1);
    expect(g.reports[0]).toMatchObject({ grant: "g-approved", outcome: "succeeded" });
  });
  it("uses one idempotency key for a retried call with the same arguments", async () => {
    const g = fakeGateway();
    await guardedCall(g.client, "t", { b: 2, a: 1 }, () => 1);
    await guardedCall(g.client, "t", { a: 1, b: 2 }, () => 1);
    const keys = g.calls.filter((c) => c.path === "/v1/gateway/actions").map((c) => (c.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });
  it("reports failed when the tool throws, and rethrows", async () => {
    const g = fakeGateway();
    await expect(guardedCall(g.client, "t", { amount: 1 }, () => { throw new Error("downstream 400"); })).rejects.toThrow("downstream 400");
    expect(g.reports[0]).toMatchObject({ outcome: "failed" });
  });
});

describe("framework adapters", () => {
  it("OpenAI Agents SDK tools return the refusal text to the model instead of running", async () => {
    const g = fakeGateway();
    let ran = 0;
    const t = aegisOpenAIAgentsTool(g.client, { name: "issue-refund", description: "", parameters: {}, execute: async (_i: { amount: number }) => ++ran });
    expect(await t.execute({ amount: 900 } as never)).toMatch(/refused/);
    expect(await t.execute(JSON.stringify({ amount: 5 }) as never)).toBe(1);
    expect(ran).toBe(1);
  });
  it("LangChain tools keep their prototype and name and route invoke through AEGIS", async () => {
    const g = fakeGateway();
    class FakeTool {
      name = "issue-refund";
      calls = 0;
      async invoke(input: { amount: number }) {
        this.calls += 1;
        return `refunded ${input.amount}`;
      }
    }
    const t = aegisLangChainTool(g.client, new FakeTool());
    expect(t).toBeInstanceOf(FakeTool);
    expect(await t.invoke({ amount: 150 } as never)).toBe("refunded 100");
    await expect(t.invoke({ amount: 900 } as never)).rejects.toBeInstanceOf(AegisRefusal);
  });
  it("LangGraph tool node turns refusals into error tool messages", async () => {
    const g = fakeGateway();
    const out = await aegisToolNode(g.client, [{ id: "c1", name: "refund", args: { amount: 10 } }, { id: "c2", name: "refund", args: { amount: 999 } }, { id: "c3", name: "nope", args: {} }], { refund: (a) => `ok ${String(a.amount)}` });
    expect(out.map((o) => o.status)).toEqual(["success", "error", "error"]);
    expect(out[0]!.content).toBe("ok 10");
  });
  it("Anthropic tool_use blocks get a tool_result, with is_error on refusal", async () => {
    const g = fakeGateway();
    const ok = await aegisAnthropicToolUse(g.client, { type: "tool_use", id: "tu1", name: "refund", input: { amount: 10 } }, { refund: () => ({ done: true }) });
    expect(ok).toEqual({ type: "tool_result", tool_use_id: "tu1", content: '{"done":true}' });
    const no = await aegisAnthropicToolUse(g.client, { type: "tool_use", id: "tu2", name: "refund", input: { amount: 999 } }, { refund: () => ({ done: true }) });
    expect(no.is_error).toBe(true);
  });
  it("guard keeps the function signature for plain function-calling runtimes", async () => {
    const g = fakeGateway();
    const refund = guard(g.client, "refund", async (a: { amount: number }) => a.amount * 2);
    expect(await refund({ amount: 7 })).toBe(14);
  });
});
