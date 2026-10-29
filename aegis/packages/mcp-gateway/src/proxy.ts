import { AegisRefusal, guardedCall, type AegisClient, type GuardOptions } from "@aegis/sdk";
import type { JsonRpcPeer } from "./jsonrpc.js";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface McpGatewayOptions {
  /** Prefix added to MCP tool names to form AEGIS tool keys, for example "github." so "create_issue" becomes "github.create_issue". */
  toolKeyPrefix?: string;
  /** Tools hidden from the client entirely. Hidden tools cannot be called even by name. */
  hideTools?: string[];
  /** Per-tool options passed to the guard (resource, justification, approval waiting). */
  toolOptions?: Record<string, GuardOptions>;
  /** Called for every decision, for logging. Never receives argument values. */
  onDecision?: (e: { tool: string; decision: string; requestId: string }) => void;
  /**
   * Refuse to start, or to refresh the tool list, when the definitions cannot be reported to AEGIS for pinning
   * (docs/TOOL_PINNING.md). Off by default: the gateway still blocks a tool with a known change either way.
   */
  requireDefinitionReport?: boolean;
}

/** Outcome of reporting a tool's definition to AEGIS: changed and already_pending mean the tool is blocked. */
export type DefinitionOutcome = "pinned" | "unchanged" | "changed" | "already_pending" | "not_registered" | "not_reported";

/**
 * MCP gateway: an MCP server to the client (the agent), an MCP client to the real server.
 *
 * - initialize: answered from the downstream server's own capabilities, tools only.
 * - tools/list: the downstream list, minus hidden tools. Every listed tool is still enforced.
 * - tools/call: asks AEGIS first (agent execution mode). Only on allow or restrict is the call
 *   forwarded, with the gateway's (possibly narrowed) arguments; the outcome is reported back.
 *   Every refusal is returned as a tool result with isError true, so the model sees the reason.
 * - Anything else (resources, prompts, sampling) is refused: this proxy exposes tools only, so
 *   nothing reaches the server around the gateway.
 *
 * Enforcement holds for clients configured to use this proxy instead of the server. A client that
 * can still reach the server directly is outside AEGIS; the enforcement-path audit looks for that.
 */
export class McpGatewayProxy {
  private tools: McpTool[] = [];
  private serverInfo: Record<string, unknown> = {};
  private protocolVersion = "2025-06-18";
  private definitionStatus = new Map<string, DefinitionOutcome>();

  constructor(
    private readonly client: JsonRpcPeer,
    private readonly server: JsonRpcPeer,
    private readonly aegis: AegisClient,
    private readonly opts: McpGatewayOptions = {},
  ) {
    client.onRequest = (msg) => this.handle(msg.method!, (msg.params ?? {}) as Record<string, unknown>);
    client.onNotification = () => undefined;
    // A server that changes its tools mid-session announces it; the new list is reported to AEGIS before use.
    server.onNotification = (msg) => {
      if (msg.method === "notifications/tools/list_changed") void this.refreshTools().catch(() => undefined);
    };
    server.onRequest = () => {
      // Server-initiated requests (sampling, elicitation) would let the server act through the client unchecked.
      throw Object.assign(new Error("The AEGIS MCP gateway does not relay server-initiated requests"), { code: -32601 });
    };
  }

  /** Connects to the downstream server and loads its tool list. */
  async connect(): Promise<McpTool[]> {
    const init = await this.server.request("initialize", { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: "aegis-mcp-gateway", version: "0.1.0" } });
    if (init.error) throw new Error(`downstream initialize failed: ${init.error.message}`);
    const r = init.result as { protocolVersion?: string; serverInfo?: Record<string, unknown> };
    this.protocolVersion = r.protocolVersion ?? this.protocolVersion;
    this.serverInfo = r.serverInfo ?? {};
    this.server.notify("notifications/initialized");
    return this.refreshTools();
  }

  async refreshTools(): Promise<McpTool[]> {
    const list = await this.server.request("tools/list", {});
    if (list.error) throw new Error(`downstream tools/list failed: ${list.error.message}`);
    const hidden = new Set(this.opts.hideTools ?? []);
    this.tools = ((list.result as { tools?: McpTool[] }).tools ?? []).filter((t) => !hidden.has(t.name));
    await this.reportDefinitions();
    return this.tools;
  }

  /**
   * Sends every listed tool's definition, with the server's name and version, to AEGIS for pinning. A tool
   * whose definition or server version differs from the approved one is blocked here as well as at the gateway.
   */
  private async reportDefinitions() {
    const out = this.tools.length
      ? await this.aegis.reportToolDefinitions({
          server: { name: typeof this.serverInfo.name === "string" ? this.serverInfo.name : null, version: typeof this.serverInfo.version === "string" ? this.serverInfo.version : null },
          tools: this.tools.map((t) => ({ key: this.toolKey(t.name), name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
        })
      : { results: [] };
    if (!out && this.opts.requireDefinitionReport) throw new Error("could not report tool definitions to AEGIS for pinning");
    this.definitionStatus = new Map(this.tools.map((t) => [t.name, (out?.results.find((r) => r.key === this.toolKey(t.name))?.outcome as DefinitionOutcome | undefined) ?? "not_reported"]));
  }

  /** What AEGIS said about each listed tool's definition at the last report. */
  definitionReport(): Record<string, DefinitionOutcome> {
    return Object.fromEntries(this.definitionStatus);
  }

  listTools(): McpTool[] {
    return [...this.tools];
  }

  toolKey(name: string): string {
    return `${this.opts.toolKeyPrefix ?? ""}${name}`;
  }

  private async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize":
        return { protocolVersion: this.protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: `aegis-gateway(${String(this.serverInfo.name ?? "server")})`, version: "0.1.0" }, instructions: "Every tool call is authorized by AEGIS before it reaches the server." };
      case "ping":
        return {};
      case "tools/list":
        return { tools: this.tools };
      case "tools/call":
        return this.callTool(String(params.name ?? ""), (params.arguments ?? {}) as Record<string, unknown>);
      default:
        throw Object.assign(new Error(`${method} is not available through the AEGIS MCP gateway`), { code: -32601 });
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.tools.some((t) => t.name === name)) return { content: [{ type: "text", text: `Unknown or hidden tool: ${name}` }], isError: true };
    const pinning = this.definitionStatus.get(name);
    if (pinning === "changed" || pinning === "already_pending") return { content: [{ type: "text", text: `Tool ${name} changed since it was approved; it cannot be used until a person reviews the change in AEGIS` }], isError: true };
    try {
      const out = await guardedCall(
        this.aegis,
        this.toolKey(name),
        args,
        async (params) => {
          const res = await this.server.request("tools/call", { name, arguments: params });
          if (res.error) throw new Error(`server error: ${res.error.message}`);
          const result = res.result as { isError?: boolean };
          // A tool-level error is a definitive failure the server reported; surface it so it is recorded as failed.
          if (result?.isError) throw Object.assign(new Error("tool reported an error"), { mcpResult: result });
          return result;
        },
        this.opts.toolOptions?.[name],
      );
      this.opts.onDecision?.({ tool: name, decision: out.decision.decision, requestId: out.decision.requestId });
      return out.result;
    } catch (e) {
      if (e instanceof AegisRefusal) {
        this.opts.onDecision?.({ tool: name, decision: e.decision.decision, requestId: e.decision.requestId });
        return { content: [{ type: "text", text: e.message }], isError: true, _meta: { aegis: { decision: e.decision.decision, requestId: e.decision.requestId } } };
      }
      const mcpResult = (e as { mcpResult?: unknown }).mcpResult;
      if (mcpResult) return mcpResult;
      return { content: [{ type: "text", text: e instanceof Error ? e.message : "tool failed" }], isError: true };
    }
  }
}
