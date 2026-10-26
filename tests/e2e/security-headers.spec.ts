import { expect, test, type Page } from "@playwright/test";
import { go, loginAs } from "./helpers";

// Browser security headers and the content security policy: present on every page, a fresh nonce on every script,
// and no page logs a policy violation (public pages here; every product page through site-check.spec.ts, whose
// sessions also fail on violations). Run against production with E2E_BASE_URL=https://<your domain>.

const PUBLIC_PAGES = ["/", "/demo", "/login", "/signup", "/forgot-password", "/pricing", "/try", "/status", "/join", "/apply/horizon", "/en/reset-password?token=x", "/en/magic-link?token=x"];

/** Collects policy violations reported by the page itself (works in every browser). */
async function watchViolations(page: Page) {
  const seen: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content[ -]Security[ -]Policy/i.test(m.text())) seen.push(m.text().slice(0, 300));
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return async () => [...seen, ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []))];
}

test("security headers on pages and API responses", async ({ request }) => {
  for (const path of ["/", "/login", "/api/health"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["strict-transport-security"], path).toContain("max-age=");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"], path).toBe("SAMEORIGIN");
    expect(h["permissions-policy"], path).toContain("camera=()");
  }
  const page = await request.get("/login");
  const csp = page.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) expect(csp).toContain(d);
  expect(csp).not.toContain("unsafe-eval");
});

test("every script carries this response's nonce, and the nonce changes per response", async ({ request }) => {
  const nonces = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const res = await request.get("/login");
    const nonce = /'nonce-([^']+)'/.exec(res.headers()["content-security-policy"] ?? "")?.[1] ?? "";
    expect(nonce).not.toBe("");
    nonces.add(nonce);
    const html = await res.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s, s).toContain(`nonce="${nonce}"`);
  }
  expect(nonces.size).toBe(2);
});

test("public pages log no policy violations", async ({ page }) => {
  const violations = await watchViolations(page);
  const problems: string[] = [];
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    for (const v of await violations()) problems.push(`${path}: ${v}`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("product pages with rich client code log no policy violations (en and ar)", async ({ browser }) => {
  test.setTimeout(300_000);
  for (const locale of ["en", "ar"] as const) {
    const s = await loginAs(browser, "admin", locale);
    const violations = await watchViolations(s.page);
    for (const path of ["/home", "/analytics", "/admin/workflows", "/admin/forms", "/calendar", "/documents", "/admin/sign-in"]) {
      await go(s, path);
      await s.page.waitForLoadState("networkidle").catch(() => undefined);
    }
    const found = await violations();
    s.errors.push(...found);
    await s.context.close();
    expect(s.errors, s.errors.join("\n")).toEqual([]);
  }
});

test("uploads are checked by content, not by name or declared type", async ({ browser }) => {
  const s = await loginAs(browser, "parent", "en");
  const post = (name: string, mimeType: string, body: string) => s.context.request.post("/api/uploads", { multipart: { file: { name, mimeType, buffer: Buffer.from(body, "latin1") } } });
  expect((await post("note.pdf", "application/pdf", "<html><script>alert(1)</script></html>")).status()).toBe(415);
  expect((await post("photo.png", "image/png", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')).status()).toBe(415);
  const ok = await post("note.pdf", "text/html", "%PDF-1.4\n1 0 obj << >> endobj\n%%EOF");
  expect(ok.status()).toBe(200);
  expect(((await ok.json()) as { type: string }).type).toBe("application/pdf");
  await s.context.close();
});

test("error responses do not reveal stack traces or internals", async ({ request }) => {
  for (const path of ["/api/documents/does-not-exist/download", "/api/fees/invoices/x/pdf", "/en/cases/not-a-real-id", "/api/v1/students"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    const body = await res.text();
    expect(res.status(), path).toBeLessThan(500);
    // Stack frames ("at fn (/srv/app/file.js:12:34)"), server paths or Prisma query text.
    expect(body, path).not.toMatch(/\bat [^\s(]+ \((\/|file:|node:)[^)]*:\d+:\d+\)|node_modules\/|\.next\/server|Invalid `prisma\./);
  }
});
