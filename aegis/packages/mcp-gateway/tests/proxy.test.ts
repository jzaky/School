import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { AegisClient } from "@aegis/sdk";
import { JsonRpcPeer, McpGatewayProxy } from "../src/index.js";

/** Stand-in for the AEGIS gateway API: allows transfers up to 100, narrows to 100 up to 200, refuses above. */
function fakeAegis() {
  const seen: { tool: string; amount: unknown }[] = [];
  const reports: { outcome: string }[] = [];
  let n = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/v1/gateway/actions") {
      seen.push({ tool: body.tool, amount: body.params.amount });
      const id = `r${++n}`;
      const a = Number(body.params.amount ?? 0);
      const base = { requestId: id, reasons: [], riskIndicators: [], policyVersionIds: [], matchedRuleIds: [], correlationId: id };
      if (a <= 100) return Response.json({ ...base, status: "allowed", decision: "allow", grant: { token: "g", expiresAt: "" } });
      if (a <= 200) return Response.json({ ...base, status: "allowed", decision: "restrict", grant: { token: "g", expiresAt: "" }, restrictions: { applied: [], params: { ...body.params, amount: 100 }, note: "" } });
      return Response.json({ ...base, status: "denied", decision: "deny", reasons: ["Transfers above 200 are refused"] }, { status: 403 });
    }
    if (path.endsWith("/execute")) {
      reports.push(body);
      return Response.json({});
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  return { aegis: new AegisClient({ baseUrl: "https://aegis.test", apiKey: "k", fetchImpl }), seen, reports };
}

let child: ChildProcess;
let agent: JsonRpcPeer;
let fa: ReturnType<typeof fakeAegis>;

beforeAll(async () => {
  child = spawn(process.execPath, [fileURLToPath(new URL("./fake-mcp-server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"] });
  const server = new JsonRpcPeer(child.stdout!, child.stdin!);
  // The agent side: two in-memory pipes between a test client and the proxy.
  const toProxy = new PassThrough();
  const toAgent = new PassThrough();
  const proxySide = new JsonRpcPeer(toProxy, toAgent);
  agent = new JsonRpcPeer(toAgent, toProxy);
  fa = fakeAegis();
  const proxy = new McpGatewayProxy(proxySide, server, fa.aegis, { toolKeyPrefix: "bank.", hideTools: ["drop_tables"] });
  await proxy.connect();
});
afterAll(() => child.kill());

const call = async (name: string, args: Record<string, unknown>) => (await agent.request("tools/call", { name, arguments: args })).result as { content: { text: string }[]; isError?: boolean };

describe("MCP gateway", () => {
  it("initializes as a tools-only server and hides tools the operator removed", async () => {
    const init = (await agent.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent", version: "1" } })).result as { capabilities: Record<string, unknown> };
    expect(Object.keys(init.capabilities)).toEqual(["tools"]);
    const tools = ((await agent.request("tools/list", {})).result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toEqual(["transfer", "calls"]);
    expect((await call("drop_tables", {})).isError).toBe(true);
  });
  it("forwards an allowed call and reports it", async () => {
    const r = await call("transfer", { amount: 40 });
    expect(r.content[0]!.text).toBe("moved 40");
    expect(fa.seen.at(-1)).toEqual({ tool: "bank.transfer", amount: 40 });
    expect(fa.reports.at(-1)?.outcome).toBe("succeeded");
  });
  it("forwards a restricted call with the narrowed arguments only", async () => {
    expect((await call("transfer", { amount: 150 })).content[0]!.text).toBe("moved 100");
  });
  it("never forwards a refused call, and tells the model why", async () => {
    const r = await call("transfer", { amount: 5000 });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/above 200/);
    const serverSaw = JSON.parse((await call("calls", {})).content[0]!.text) as { arguments: { amount: number } }[];
    expect(serverSaw.map((c) => c.arguments.amount)).toEqual([40, 100]);
  });
  it("records a server-reported tool error as failed", async () => {
    const r = await call("transfer", { amount: 13 });
    expect(r.isError).toBe(true);
    expect(fa.reports.at(-1)?.outcome).toBe("failed");
  });
  it("refuses methods that would bypass tool enforcement", async () => {
    const r = await agent.request("resources/read", { uri: "file:///etc/passwd" });
    expect(r.error?.code).toBe(-32601);
  });
});
