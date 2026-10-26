// Security building blocks that need no database: the content security policy, client addresses for rate limits,
// upload checks by content, download headers, case note encryption, log redaction, request size limits, redirect
// allowlists, session lifetime and the optional malware scan.
import { describe, expect, it } from "vitest";
import net from "node:net";
import { contentSecurityPolicy, newNonce, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";
import { clientIp } from "@/server/access/rate-limit";
import { checkFile, contentDisposition, dispositionFor, DOCUMENT_KINDS, IMAGE_KINDS, mimeForName, safeFileName, sniffFile } from "@/lib/files/check";
import { isSealed, openText, sealText } from "@/lib/sealed-text";
import { redactLogArg } from "@/lib/log-redaction";
import { BodyTooLargeError, readBodyLimited, readFormLimited } from "@/lib/http-body";
import { safeReturnTo } from "@/server/sso/web";
import { isJoinPath } from "@/server/access/sign-in";
import { redirectTo } from "@/lib/redirect";
import { absoluteSessionMs, sessionTooOld } from "@/server/sso/session-revocation";
import { scanBytes, scanRefuses } from "@/server/files/scan";
import { createZip } from "@/lib/zip";
import { ownsStoredKey } from "@/server/documents/storage-core";
import { isBlockedAddress } from "@/server/integrations/fetch-export";
import { checkOutboundUrl } from "@/server/sso/http";
import { BlockedAddressError, guardedFetch } from "@/server/integrations/guarded-fetch";

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const PDF = bytes("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const zip = (names: string[]) => new Uint8Array(createZip(names.map((name) => ({ name, data: Buffer.from("<x/>"), date: new Date() }))));

describe("content security policy", () => {
  it("allows only nonce-tagged scripts and locks down objects, base, forms and framing", () => {
    const nonce = newNonce();
    const csp = contentSecurityPolicy(nonce);
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toMatch(/form-action 'self'/);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(nonce, { dev: true })).toContain("unsafe-eval");
  });

  it("uses a fresh nonce each time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("sends the static headers every response needs", () => {
    const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
    for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"]) expect(keys).toContain(k);
    expect(STATIC_SECURITY_HEADERS.find((h) => h.key === "Permissions-Policy")?.value).toContain("camera=()");
  });
});

describe("client address for rate limits", () => {
  it("ignores addresses the client put in X-Forwarded-For", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }), {})).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), {})).toBe("203.0.113.9");
  });

  it("honours the number of trusted proxies", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.9, 10.0.0.2" }), { TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.9");
  });

  it("falls back to X-Real-IP, then a fixed key", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }), {})).toBe("198.51.100.7");
    expect(clientIp(new Headers(), {})).toBe("local");
  });
});

describe("server-side request forgery guard", () => {
  it("refuses private addresses written in any IPv6 form", () => {
    for (const a of ["::ffff:7f00:1", "::ffff:127.0.0.1", "::7f00:1", "0:0:0:0:0:ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:a00:1::", "2001::1", "2001:db8::1", "fec0::1", "fe80::1%eth0", "ff02::1", "fd12:3456::1", "::", "::1"]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ["2606:4700::1111", "2001:4860:4860::8888", "64:ff9b::808:808", "2002:808:808::1"]) expect(isBlockedAddress(a), a).toBe(false);
  });

  it("refuses IPv6 literals in URLs before connecting", () => {
    for (const u of ["https://[::ffff:127.0.0.1]/", "https://[::ffff:169.254.169.254]/latest", "https://[64:ff9b::a9fe:a9fe]/", "https://127.1/", "https://2130706433/"]) {
      expect(() => checkOutboundUrl(u), u).toThrow();
    }
    expect(checkOutboundUrl("https://idp.example.com/.well-known/openid-configuration").hostname).toBe("idp.example.com");
  });
});

describe("guarded fetch for catalog pages and push endpoints", () => {
  it("refuses loopback by literal and by name, and works when private addresses are allowed (tests only)", async () => {
    const server = (await import("node:http")).createServer((_, res) => res.end("internal secret"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      await expect(guardedFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(BlockedAddressError);
      await expect(guardedFetch(`http://localhost:${port}/`)).rejects.toBeInstanceOf(BlockedAddressError);
      await expect(guardedFetch(`http://[::ffff:127.0.0.1]:${port}/`)).rejects.toBeInstanceOf(BlockedAddressError);
      process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = "true";
      const res = await guardedFetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe("internal secret");
    } finally {
      delete process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS;
      server.close();
    }
  });
});

describe("upload checks by content", () => {
  const opts = { allow: DOCUMENT_KINDS, maxBytes: 1024 * 1024 };

  it("accepts documents and photos whose name matches their content", () => {
    expect(checkFile("note.pdf", PDF, opts)).toMatchObject({ ok: true, type: { mime: "application/pdf" }, fileName: "note.pdf" });
    expect(checkFile("photo.png", PNG, opts)).toMatchObject({ ok: true, type: { kind: "png" } });
    expect(checkFile("list.csv", bytes("name,grade\nAdam,9\n"), opts)).toMatchObject({ ok: true, type: { kind: "csv" } });
    expect(checkFile("letter.docx", zip(["[Content_Types].xml", "word/document.xml"]), opts)).toMatchObject({ ok: true, type: { kind: "docx" } });
  });

  it("refuses HTML, SVG, scripts and executables whatever they are called", () => {
    expect(checkFile("note.pdf", bytes("<html><script>alert(1)</script></html>"), opts)).toEqual({ ok: false, problem: "TYPE" });
    expect(checkFile("logo.png", bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), opts)).toEqual({ ok: false, problem: "TYPE" });
    expect(checkFile("list.csv", bytes("name\n<script>alert(1)</script>\n"), opts)).toEqual({ ok: false, problem: "TYPE" });
    expect(checkFile("setup.pdf", bytes("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"), opts)).toEqual({ ok: false, problem: "TYPE" });
  });

  it("refuses archives that are not Office documents, and Office files with macros", () => {
    expect(checkFile("files.zip", zip(["a.txt"]), opts)).toEqual({ ok: false, problem: "TYPE" });
    expect(checkFile("letter.docx", zip(["[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"]), opts)).toEqual({ ok: false, problem: "ACTIVE_CONTENT" });
  });

  it("refuses a PDF that runs code, and names whose extension does not match", () => {
    expect(checkFile("form.pdf", bytes("%PDF-1.4\n<< /OpenAction << /S /J#61vaScript /JS (app.alert(1)) >> >>"), opts)).toEqual({ ok: false, problem: "ACTIVE_CONTENT" });
    expect(checkFile("report.pdf.exe", PDF, opts)).toEqual({ ok: false, problem: "EXTENSION" });
    expect(checkFile("photo.jpg", PNG, opts)).toEqual({ ok: false, problem: "EXTENSION" });
  });

  it("enforces size and the kinds each path accepts", () => {
    expect(checkFile("note.pdf", PDF, { allow: DOCUMENT_KINDS, maxBytes: 10 })).toEqual({ ok: false, problem: "TOO_LARGE" });
    expect(checkFile("note.pdf", new Uint8Array(), opts)).toEqual({ ok: false, problem: "EMPTY" });
    expect(checkFile("note.pdf", PDF, { allow: IMAGE_KINDS, maxBytes: 1024 })).toEqual({ ok: false, problem: "TYPE" });
  });

  it("rebuilds stored names from safe characters, keeping Arabic", () => {
    expect(safeFileName("../../etc/passwd.pdf", "pdf")).toBe("etc-passwd.pdf");
    expect(safeFileName('a"b<c>\r\n.pdf', "pdf")).toBe("a-b-c.pdf");
    expect(safeFileName("شهادة طبية.pdf", "pdf")).toBe("شهادة-طبية.pdf");
    expect(sniffFile(bytes("plain"))?.kind).toBe("csv");
  });
});

describe("stored file keys from forms", () => {
  it("accept only plain paths inside the school's own folder", () => {
    expect(ownsStoredKey("orgA", "r2:orgA/2026-10/abc-note.pdf")).toBe(true);
    expect(ownsStoredKey("orgA", "local:orgA/admissions/app/x-شهادة.pdf")).toBe(true);
    for (const bad of ["r2:orgB/2026-10/x.pdf", "r2:orgA/../orgB/x.pdf", "local:orgA/./x", "r2:orgA//x", "r2:orgA\\..\\orgB", "r2:orgA", "sample:x", "https://x/orgA/a", "r2:orgAB/x"]) {
      expect(ownsStoredKey("orgA", bad), bad).toBe(false);
    }
    expect(ownsStoredKey("orgA", 42)).toBe(false);
  });
});

describe("download headers", () => {
  it("never lets a file name break the header and keeps Arabic names", () => {
    const d = contentDisposition("attachment", 'x"\r\nSet-Cookie: a=b.pdf');
    expect(d).not.toMatch(/[\r\n]/);
    expect(d.startsWith('attachment; filename="x___Set-Cookie: a=b.pdf"')).toBe(true);
    expect(contentDisposition("inline", "تقرير.pdf")).toBe(`inline; filename="_____.pdf"; filename*=UTF-8''${encodeURIComponent("تقرير.pdf")}`);
  });

  it("shows only images and PDFs inline", () => {
    expect(dispositionFor("application/pdf", "a.pdf", true).startsWith("inline")).toBe(true);
    expect(dispositionFor("text/html", "a.html", true).startsWith("attachment")).toBe(true);
    expect(dispositionFor("image/svg+xml", "a.svg", true).startsWith("attachment")).toBe(true);
    expect(mimeForName("r2:org/2026-10/abc-note.PDF")).toBe("application/pdf");
    expect(mimeForName("local:org/x.html")).toBe("application/octet-stream");
  });
});

describe("case note encryption", () => {
  it("seals and opens text, and reads older plain text unchanged", () => {
    const sealed = sealText("Met the student with the counselor present.");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("student");
    expect(openText(sealed)).toBe("Met the student with the counselor present.");
    expect(openText("Older plain note")).toBe("Older plain note");
    expect(openText("v1: draft heading")).toBe("v1: draft heading");
    expect(sealText("same")).not.toBe(sealText("same"));
  });
});

describe("log redaction", () => {
  it("keeps the failing call but drops the query arguments", () => {
    const e = new Error('\nInvalid `prisma.student.create()` invocation:\n\n{ data: { firstNameEn: "Adam", lastNameEn: "Nasser" } }\n\nArgument `x` is missing.');
    e.name = "PrismaClientValidationError";
    const out = redactLogArg(e) as Error;
    expect(out.message).toContain("prisma.student.create()");
    expect(out.message).not.toContain("Adam");
    expect(String(out.stack)).not.toContain("Nasser");
    expect(redactLogArg("plain message")).toBe("plain message");
  });
});

describe("request size limits", () => {
  it("refuses a body over the limit by its declared length or while reading", async () => {
    await expect(readBodyLimited(new Request("http://x", { method: "POST", body: "x".repeat(20), headers: { "content-length": "20" } }), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(8));
        c.close();
      },
    });
    await expect(readBodyLimited(new Request("http://x", { method: "POST", body: stream, duplex: "half" } as RequestInit), 30)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect((await readBodyLimited(new Request("http://x", { method: "POST", body: "hello" }), 10)).length).toBe(5);
  });

  it("reads multipart form data within the limit", async () => {
    const fd = new FormData();
    fd.set("file", new File([PDF], "a.pdf"));
    const r = new Request("http://x", { method: "POST", body: fd });
    const out = await readFormLimited(r, 10_000);
    expect(out?.get("file")).toBeInstanceOf(File);
  });
});

describe("redirect allowlists", () => {
  it("keeps sign-in return paths on this site", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/en//evil.example", "/en/%2F%2Fevil.example", "javascript:alert(1)", "/en/home\\@evil"]) {
      expect(safeReturnTo(bad, "en")).toBe("/en/home");
    }
    expect(safeReturnTo("/ar/requests?tab=open", "ar")).toBe("/ar/requests?tab=open");
  });

  it("only accepts join pages as the join return path", () => {
    expect(isJoinPath("/en/join?code=ABC-123")).toBe(true);
    expect(isJoinPath("//evil.example/en/join")).toBe(false);
    expect(isJoinPath("/en/join?code=ABC&next=https://evil.example")).toBe(false);
  });

  it("refuses absolute and protocol-relative redirects", () => {
    expect(() => redirectTo("//evil.example")).toThrow();
    expect(() => redirectTo("https://evil.example")).toThrow();
    expect(redirectTo("/en/home").headers.get("location")).toBe("/en/home");
  });
});

describe("session lifetime", () => {
  it("ends a session a fixed time after sign-in, 7 days unless configured", () => {
    expect(absoluteSessionMs({})).toBe(7 * 24 * 3600_000);
    expect(absoluteSessionMs({ SESSION_ABSOLUTE_HOURS: "12" })).toBe(12 * 3600_000);
    expect(absoluteSessionMs({ SESSION_ABSOLUTE_HOURS: "nonsense" })).toBe(7 * 24 * 3600_000);
    const now = Date.now();
    expect(sessionTooOld(now - 8 * 24 * 3600_000, now, {})).toBe(true);
    expect(sessionTooOld(now - 3600_000, now, {})).toBe(false);
  });
});

describe("optional malware scan", () => {
  async function fakeClamd(reply: string) {
    const server = net.createServer((sock) => {
      sock.on("data", (d) => {
        // The stream ends with a zero length chunk.
        if (d.subarray(-4).equals(Buffer.alloc(4))) sock.end(`${reply}\0`);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { server, port: (server.address() as net.AddressInfo).port };
  }

  it("is skipped unless a scanner is configured", async () => {
    expect(await scanBytes(PDF, {})).toEqual({ verdict: "skipped" });
  });

  it("reads clean and infected verdicts from clamd", async () => {
    const clean = await fakeClamd("stream: OK");
    expect(await scanBytes(PDF, { CLAMD_HOST: "127.0.0.1", CLAMD_PORT: String(clean.port) })).toEqual({ verdict: "clean" });
    clean.server.close();
    const bad = await fakeClamd("stream: Eicar-Test-Signature FOUND");
    const r = await scanBytes(PDF, { CLAMD_HOST: "127.0.0.1", CLAMD_PORT: String(bad.port) });
    expect(r).toEqual({ verdict: "infected", signature: "Eicar-Test-Signature" });
    expect(scanRefuses(r)).toBe(true);
    bad.server.close();
  });

  it("accepts uploads when the scanner is down unless told to fail closed", async () => {
    const open = await scanBytes(PDF, { CLAMD_HOST: "127.0.0.1", CLAMD_PORT: "1", CLAMD_TIMEOUT_MS: "500" });
    expect(scanRefuses(open)).toBe(false);
    const closed = await scanBytes(PDF, { CLAMD_HOST: "127.0.0.1", CLAMD_PORT: "1", CLAMD_TIMEOUT_MS: "500", CLAMD_FAIL_CLOSED: "true" });
    expect(scanRefuses(closed)).toBe(true);
  });
});
