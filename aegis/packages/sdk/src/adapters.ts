import type { AegisClient } from "./index.js";
import { AegisRefusal, guard, guardedCall, type GuardOptions } from "./guard.js";

/**
 * Thin adapters for common agent frameworks. They are duck-typed against each framework's public tool
 * shape, so this package has no runtime dependency on any of them. Each adapter returns the same
 * shape it received, with execution routed through guardedCall.
 */

/** OpenAI Agents SDK: tool({ name, description, parameters, execute }). */
export function aegisOpenAIAgentsTool<T extends { name: string; execute: (input: never, ...rest: never[]) => unknown }>(client: AegisClient, tool: T, opts: GuardOptions = {}): T {
  const original = tool.execute as (input: Record<string, unknown>, ...rest: unknown[]) => unknown;
  return {
    ...tool,
    execute: async (input: Record<string, unknown> | string, ...rest: unknown[]) => {
      const args = typeof input === "string" ? (JSON.parse(input) as Record<string, unknown>) : input;
      try {
        return (await guardedCall(client, tool.name, args, (p) => original(p, ...rest) as Promise<unknown>, opts)).result;
      } catch (e) {
        // The Agents SDK shows a returned string to the model; a refusal must be readable, not a crash.
        if (e instanceof AegisRefusal) return e.message;
        throw e;
      }
    },
  } as T;
}

/** LangChain (JS): any tool exposing name and invoke(input). Works for DynamicStructuredTool and StructuredTool instances. */
export function aegisLangChainTool<T extends { name: string; invoke: (input: never, config?: never) => Promise<unknown> }>(client: AegisClient, tool: T, opts: GuardOptions = {}): T {
  const original = tool.invoke.bind(tool) as (input: Record<string, unknown>, config?: unknown) => Promise<unknown>;
  const wrapped = Object.create(Object.getPrototypeOf(tool) as object) as T;
  Object.assign(wrapped, tool);
  (wrapped as unknown as { invoke: unknown }).invoke = async (input: Record<string, unknown> | { args?: Record<string, unknown> }, config?: unknown) => {
    const args = ((input as { args?: Record<string, unknown> }).args ?? input) as Record<string, unknown>;
    return (await guardedCall(client, tool.name, args, (p) => original(p, config), opts)).result;
  };
  return wrapped;
}

/**
 * LangGraph: runs the tool calls of an AI message through AEGIS, returning one tool message per call.
 * Use it as the body of a custom tool node. Refusals become tool messages with status "error" so the
 * graph can route back to the model instead of failing.
 */
export async function aegisToolNode(client: AegisClient, toolCalls: { id: string; name: string; args: Record<string, unknown> }[], impls: Record<string, (args: Record<string, unknown>) => unknown>, opts: Record<string, GuardOptions> = {}) {
  const out: { tool_call_id: string; name: string; content: string; status: "success" | "error" }[] = [];
  for (const call of toolCalls) {
    const impl = impls[call.name];
    if (!impl) {
      out.push({ tool_call_id: call.id, name: call.name, content: `Unknown tool ${call.name}`, status: "error" });
      continue;
    }
    try {
      const r = await guardedCall(client, call.name, call.args, (p) => impl(p), opts[call.name]);
      out.push({ tool_call_id: call.id, name: call.name, content: typeof r.result === "string" ? r.result : JSON.stringify(r.result), status: "success" });
    } catch (e) {
      out.push({ tool_call_id: call.id, name: call.name, content: e instanceof Error ? e.message : "tool failed", status: "error" });
    }
  }
  return out;
}

/**
 * Anthropic Messages API: answers a tool_use content block. Returns the tool_result block to send
 * back in the next user turn; a refusal is returned with is_error so the model sees why.
 */
export async function aegisAnthropicToolUse(client: AegisClient, block: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }, impls: Record<string, (input: Record<string, unknown>) => unknown>, opts: Record<string, GuardOptions> = {}) {
  const impl = impls[block.name];
  if (!impl) return { type: "tool_result" as const, tool_use_id: block.id, content: `Unknown tool ${block.name}`, is_error: true };
  try {
    const r = await guardedCall(client, block.name, block.input, (p) => impl(p), opts[block.name]);
    return { type: "tool_result" as const, tool_use_id: block.id, content: typeof r.result === "string" ? r.result : JSON.stringify(r.result) };
  } catch (e) {
    return { type: "tool_result" as const, tool_use_id: block.id, content: e instanceof Error ? e.message : "tool failed", is_error: true };
  }
}

/** Microsoft agent frameworks and any function-calling runtime: wrap the plain function. */
export const aegisFunction = guard;
