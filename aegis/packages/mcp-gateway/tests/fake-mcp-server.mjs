// Minimal stdio MCP server for tests: two tools, records calls to stderr-free state via a tool.
import process from "node:process";
import { createInterface } from "node:readline";
const calls = [];
const rl = createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "initialize") return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-bank", version: "1" } } });
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "transfer", inputSchema: { type: "object" } }, { name: "calls", inputSchema: { type: "object" } }, { name: "drop_tables", inputSchema: { type: "object" } }] } });
  if (msg.method === "tools/call") {
    if (msg.params.name === "calls") return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(calls) }] } });
    calls.push({ name: msg.params.name, arguments: msg.params.arguments });
    if (msg.params.arguments.amount === 13) return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "insufficient funds" }], isError: true } });
    return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `moved ${msg.params.arguments.amount}` }] } });
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "nope" } });
});
