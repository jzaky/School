// Fetching a school's export file for scheduled sync. HTTPS only, with optional basic auth or a bearer token.
// Guards against server-side request forgery: every address the host name resolves to is checked at connect
// time (so a DNS answer cannot switch to an internal address after the check), private, loopback,
// link-local and metadata ranges are refused, redirects are not followed, and size and time are capped.
// INTEGRATIONS_ALLOW_PRIVATE_URLS=true lifts the address check and allows plain HTTP (tests and local
// development only; never set it in production).
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { MAX_FILE_BYTES } from "@/lib/imports/types";

export type SyncAuth = { type: "NONE" } | { type: "BASIC"; username: string; password: string } | { type: "BEARER"; token: string };

export class FetchExportError extends Error {
  constructor(public code: "URL" | "BLOCKED_ADDRESS" | "AUTH" | "HTTP_STATUS" | "REDIRECT" | "TIMEOUT" | "TOO_LARGE" | "NETWORK" | "EMPTY") {
    super(`fetch:${code}`);
  }
}

const allowPrivate = () => process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS === "true";

/** True for addresses a school export can never legitimately live on. */
export function isBlockedAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = address.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

/** Checks the address shape of a source URL. Returns an error code or null. */
export function checkSourceUrl(raw: string): "URL" | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "URL";
  }
  if (u.username || u.password) return "URL";
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) return "URL";
  if (raw.length > 2000) return "URL";
  return null;
}

function guardedLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, [], 0);
    const list = addresses as LookupAddress[];
    if (!allowPrivate() && (!list.length || list.some((a) => isBlockedAddress(a.address)))) {
      const e = new Error("blocked address") as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return cb(e, [], 0);
    }
    if ((options as { all?: boolean }).all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

export type FetchedExport = { buf: Buffer; contentType: string | null; fileName: string };

export async function fetchExport(rawUrl: string, auth: SyncAuth, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchedExport> {
  if (checkSourceUrl(rawUrl)) throw new FetchExportError("URL");
  const url = new URL(rawUrl);
  if (!allowPrivate() && isIP(url.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ""))) throw new FetchExportError("BLOCKED_ADDRESS");
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES;
  const headers: Record<string, string> = { Accept: "text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*", "User-Agent": "SchoolOS-Sync/1" };
  if (auth.type === "BASIC") headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")}`;
  if (auth.type === "BEARER") headers.Authorization = `Bearer ${auth.token}`;
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<FetchedExport>((resolve, reject) => {
    const req = mod.request(url, { method: "GET", headers, lookup: guardedLookup as never, timeout: opts.timeoutMs ?? 30_000 }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return reject(new FetchExportError("REDIRECT"));
      }
      if (status === 401 || status === 403) {
        res.resume();
        return reject(new FetchExportError("AUTH"));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new FetchExportError("HTTP_STATUS"));
      }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > maxBytes) {
        res.destroy();
        return reject(new FetchExportError("TOO_LARGE"));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new FetchExportError("TOO_LARGE"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return reject(new FetchExportError("EMPTY"));
        const name = decodeURIComponent(url.pathname.split("/").pop() ?? "") || "export";
        resolve({ buf, contentType: (res.headers["content-type"] as string | undefined) ?? null, fileName: name.slice(0, 120) });
      });
      res.on("error", () => reject(new FetchExportError("NETWORK")));
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new FetchExportError("TIMEOUT"));
    });
    req.on("error", (err: NodeJS.ErrnoException) => reject(new FetchExportError(err.code === "EBLOCKED" ? "BLOCKED_ADDRESS" : "NETWORK")));
    req.end();
  });
}

/** Spreadsheet (.xlsx is a zip file) or text. */
export function isXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}
