#!/usr/bin/env -S npx tsx
/**
 * Runs the AEGIS MCP gateway in front of a stdio MCP server.
 *
 *   AEGIS_API_URL=https://aegis-api.example AEGIS_AGENT_KEY=aegis_ak_... \
 *     aegis-mcp-gateway --prefix github. -- npx -y @modelcontextprotocol/server-github
 *
 * Point the agent's MCP client at this command instead of the server's. Logs go to stderr only;
 * stdout carries the protocol.
 */
import { spawn } from "node:child_process";
import { AegisClient } from "@aegis/sdk";
import { JsonRpcPeer } from "./jsonrpc.js";
import { McpGatewayProxy } from "./proxy.js";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  process.stderr.write("usage: aegis-mcp-gateway [--prefix <p>] [--hide tool,tool] -- <server command> [args...]\n");
  process.exit(2);
}
const flags = argv.slice(0, sep);
const prefix = flags.includes("--prefix") ? flags[flags.indexOf("--prefix") + 1] ?? "" : "";
const hide = flags.includes("--hide") ? (flags[flags.indexOf("--hide") + 1] ?? "").split(",").filter(Boolean) : [];
const baseUrl = process.env.AEGIS_API_URL;
const apiKey = process.env.AEGIS_AGENT_KEY;
if (!baseUrl || !apiKey) {
  process.stderr.write("AEGIS_API_URL and AEGIS_AGENT_KEY are required\n");
  process.exit(2);
}
const [cmd, ...cmdArgs] = argv.slice(sep + 1);
const child = spawn(cmd!, cmdArgs, { stdio: ["pipe", "pipe", "inherit"] });
child.on("exit", (code) => process.exit(code ?? 1));
const server = new JsonRpcPeer(child.stdout!, child.stdin!);
const clientPeer = new JsonRpcPeer(process.stdin, process.stdout);
const proxy = new McpGatewayProxy(clientPeer, server, new AegisClient({ baseUrl, apiKey }), { toolKeyPrefix: prefix, hideTools: hide, onDecision: (e) => process.stderr.write(`aegis ${e.decision} ${e.tool} ${e.requestId}\n`) });
proxy.connect().then(
  (tools) => process.stderr.write(`aegis-mcp-gateway: ${tools.length} tools behind AEGIS\n`),
  (e: unknown) => {
    process.stderr.write(`aegis-mcp-gateway: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
