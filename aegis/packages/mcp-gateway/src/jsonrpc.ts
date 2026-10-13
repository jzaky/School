import type { Readable, Writable } from "node:stream";

/** One JSON-RPC 2.0 message as MCP's stdio transport carries it: one JSON object per line. */
export type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } };

/**
 * A newline-delimited JSON-RPC endpoint over a pair of streams. Requests it sends are matched to
 * responses by id; requests and notifications it receives go to the handler.
 */
export class JsonRpcPeer {
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<string | number, { resolve: (m: JsonRpcMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  onRequest: (msg: JsonRpcMessage) => Promise<unknown> | unknown = () => {
    throw Object.assign(new Error("Method not found"), { code: -32601 });
  };
  onNotification: (msg: JsonRpcMessage) => void = () => undefined;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly timeoutMs = 30_000,
  ) {
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.receive(chunk));
    input.on("close", () => this.failAll(new Error("peer closed")));
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        this.write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      void this.dispatch(msg);
    }
  }

  private async dispatch(msg: JsonRpcMessage) {
    if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(msg);
      return;
    }
    if (msg.method !== undefined && (msg.id === undefined || msg.id === null)) {
      this.onNotification(msg);
      return;
    }
    try {
      const result = await this.onRequest(msg);
      this.write({ jsonrpc: "2.0", id: msg.id, result });
    } catch (e) {
      const code = typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : -32603;
      this.write({ jsonrpc: "2.0", id: msg.id, error: { code, message: e instanceof Error ? e.message : "Internal error" } });
    }
  }

  write(msg: JsonRpcMessage) {
    this.output.write(`${JSON.stringify(msg)}\n`);
  }

  request(method: string, params?: unknown): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private failAll(err: Error) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}
