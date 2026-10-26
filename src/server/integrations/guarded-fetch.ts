// A fetch() for addresses that come from people (catalog source pages, push service endpoints): the same server-side
// request forgery guard as scheduled sync (./fetch-export.ts). Every address the host name resolves to is checked
// when the connection is made, so private, loopback, link-local and metadata addresses are refused even when a
// DNS answer changes after a first check. Redirects are never followed here; callers that follow them call this
// again for each hop. No "server-only" marker: the worker uses it.
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { allowPrivate, guardedLookup, isBlockedAddress } from "./fetch-export";

export class BlockedAddressError extends Error {
  constructor() {
    super("blocked address");
    this.name = "BlockedAddressError";
  }
}

export function guardedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new TypeError("invalid url"));
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new TypeError("unsupported protocol"));
    if (u.username || u.password) return reject(new TypeError("credentials in url"));
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!allowPrivate() && isIP(host) && isBlockedAddress(host)) return reject(new BlockedAddressError());
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((v, k) => (headers[k] = v));
    const raw = init.body;
    const body = raw === undefined || raw === null ? null : typeof raw === "string" ? Buffer.from(raw) : raw instanceof ArrayBuffer ? Buffer.from(new Uint8Array(raw)) : ArrayBuffer.isView(raw) ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : null;
    if (body) headers["content-length"] = String(body.length);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: init.method ?? "GET", headers, lookup: guardedLookup as never, signal: init.signal ?? undefined }, (res) => {
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      const status = res.statusCode ?? 502;
      const empty = status === 204 || status === 304 || (init.method ?? "GET") === "HEAD";
      if (empty) res.resume();
      try {
        resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status: status >= 200 && status <= 599 ? status : 502, headers: out }));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (err: NodeJS.ErrnoException) => reject(err.code === "EBLOCKED" ? new BlockedAddressError() : err));
    if (body) req.write(body);
    req.end();
  });
}
