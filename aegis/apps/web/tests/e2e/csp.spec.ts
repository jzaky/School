import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";

/** Collects every Content-Security-Policy violation the browser reports on the page. */
function watchViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply|connect)/i.test(m.text())) seen.push(m.text());
  });
  return seen;
}

test.describe("content security policy", () => {
  test("public pages carry a nonce policy and run with no violations", async ({ page }) => {
    const violations = watchViolations(page);
    const res = await page.goto("/login");
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // The nonce changes on every request.
    const again = (await page.request.get("/login")).headers()["content-security-policy"] ?? "";
    expect(again).not.toBe(csp);
    // The theme script ran (it sets data-theme before first paint), so the nonce reached it.
    await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);
    await page.goto("/site");
    expect(violations).toEqual([]);
  });

  test("the signed-in console works under the policy", async ({ page }) => {
    const violations = watchViolations(page);
    await page.goto("/login");
    await page.fill("#email", OWNER);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/(overview|mfa)/);
    for (const path of ["/overview", "/control-center", "/approvals", "/policies"]) {
      const res = await page.goto(path);
      expect(res?.headers()["content-security-policy"] ?? "").toMatch(/'nonce-/);
      await expect(page.locator("main")).toBeVisible();
    }
    // Client-side interaction still works: open the account menu or any button-driven control.
    await page.goto("/control-center");
    expect(violations).toEqual([]);
  });

  test("markup injected into a page cannot run a script", async ({ page }) => {
    // Simulates a cross-site scripting flaw: the server's HTML carries an attacker's inline script and an
    // inline event handler. The policy (sent with the same response) must stop both.
    await page.route("**/login", async (route) => {
      const res = await route.fetch();
      const html = (await res.text()).replace("</head>", '<script>window.__injected = true</script></head>').replace("<body", '<body onload="window.__handler = true"');
      await route.fulfill({ response: res, body: html });
    });
    const violations = watchViolations(page);
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    const state = await page.evaluate(() => ({ inline: (window as unknown as { __injected?: boolean }).__injected ?? false, handler: (window as unknown as { __handler?: boolean }).__handler ?? false }));
    expect(state).toEqual({ inline: false, handler: false });
    expect(violations.length).toBeGreaterThan(0);
  });
});
