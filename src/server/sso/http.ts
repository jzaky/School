// Outbound HTTPS for single sign-on and rostering: identity provider discovery, keys, token and user info
// calls, and roster API pages. Same server-side request forgery guards as scheduled sync
// (src/server/integrations/fetch-export.ts): HTTPS only, every resolved address checked at connect time,
// private and metadata ranges refused, no redirects, capped size and time. INTEGRATIONS_ALLOW_PRIVATE_URLS=true
// lifts the address check and allows plain HTTP for tests and local mocks only.
// Errors carry a code, never a response body (bodies can echo personal data or secrets).
// No "server-only" marker: the worker imports this.
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { allowPrivate, guardedLookup, isBlockedAddress } from "@/server/integrations/fetch-export";

export class HttpError extends Error {
  constructor(
    public code: "URL" | "BLOCKED_ADDRESS" | "REDIRECT" | "STATUS" | "TIMEOUT" | "TOO_LARGE" | "NETWORK" | "JSON",
    public status = 0,
  ) {
    super(`http:${code}${status ? `:${status}` : ""}`);
  }
}

export type HttpResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

export type HttpRequest = {
  method?: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

/** Checks that a URL may be called from the server. Returns the parsed URL or throws HttpError("URL"). */
export function checkOutboundUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError("URL");
  }
  if (u.username || u.password || raw.length > 2000) throw new HttpError("URL");
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) throw new HttpError("URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && isIP(host) && isBlockedAddress(host)) throw new HttpError("BLOCKED_ADDRESS");
  return u;
}

/** One request. Non-2xx statuses resolve (the caller decides); redirects are refused. */
export function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  const url = checkOutboundUrl(req.url);
  const mod = url.protocol === "https:" ? https : http;
  const maxBytes = req.maxBytes ?? 4 * 1024 * 1024;
  const headers: Record<string, string> = { "User-Agent": "Horizon-SSO/1", ...(req.headers ?? {}) };
  if (req.body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(req.body));
  return new Promise<HttpResponse>((resolve, reject) => {
    const r = mod.request(url, { method: req.method ?? "GET", headers, lookup: guardedLookup as never, timeout: req.timeoutMs ?? 15_000 }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return reject(new HttpError("REDIRECT", status));
      }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > maxBytes) {
        res.destroy();
        return reject(new HttpError("TOO_LARGE"));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new HttpError("TOO_LARGE"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", () => reject(new HttpError("NETWORK")));
    });
    r.on("timeout", () => {
      r.destroy();
      reject(new HttpError("TIMEOUT"));
    });
    r.on("error", (err: NodeJS.ErrnoException) => reject(new HttpError(err.code === "EBLOCKED" ? "BLOCKED_ADDRESS" : "NETWORK")));
    if (req.body !== undefined) r.write(req.body);
    r.end();
  });
}

/** A JSON request that must answer 2xx with a JSON object. */
export async function httpJson<T = Record<string, unknown>>(req: HttpRequest): Promise<{ data: T; headers: http.IncomingHttpHeaders }> {
  const res = await httpRequest({ ...req, headers: { Accept: "application/json", ...(req.headers ?? {}) } });
  if (res.status < 200 || res.status >= 300) throw new HttpError("STATUS", res.status);
  try {
    const data = JSON.parse(res.body.toString("utf8")) as T;
    if (!data || typeof data !== "object") throw new Error("not an object");
    return { data, headers: res.headers };
  } catch {
    throw new HttpError("JSON");
  }
}

export const form = (fields: Record<string, string | undefined>) =>
  Object.entries(fields)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

export const basicAuth = (user: string, pass: string) => `Basic ${Buffer.from(`${encodeURIComponent(user)}:${encodeURIComponent(pass)}`, "utf8").toString("base64")}`;
