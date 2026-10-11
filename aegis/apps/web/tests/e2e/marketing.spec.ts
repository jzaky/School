import { test, expect } from "@playwright/test";

const PAGES = ["/", "/site", "/site/products", "/site/tour", "/site/architecture", "/site/security", "/site/open-source", "/site/pricing", "/site/contact", "/site/demo", "/site/privacy", "/site/terms"];
const FORBIDDEN = ["certified", "SOC 2", "customers trust", "guarantee"];

test.describe("marketing site", () => {
  test("home renders the hero and four module cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Define what your AI agents may do. Enforce it before execution. Prove what happened.");
    await expect(page.getByRole("link", { name: "Request a demo" }).first()).toHaveAttribute("href", "/site/demo");
    await expect(page.getByRole("link", { name: /Explore the product tour/ })).toHaveAttribute("href", "/site/tour");
    for (const m of ["control", "assurance", "shield", "audit"]) {
      await expect(page.locator(`[data-module="${m}"]`)).toHaveAttribute("href", `/site/products#${m}`);
    }
    await expect(page.locator("[data-module]")).toHaveCount(4);
    await expect(page.getByRole("heading", { name: "How runtime enforcement works" })).toBeVisible();
    await expect(page.getByText("No customers or certifications are claimed")).toBeVisible();
  });

  test("/site renders the same home page", async ({ page }) => {
    await page.goto("/site");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Define what your AI agents may do");
  });

  test("header navigation reaches every page", async ({ page }) => {
    const expected: [string, RegExp][] = [
      ["Products", /Four modules, one enforcement path/],
      ["Tour", /One transfer, start to finish/],
      ["Architecture", /A modular monolith/],
      ["Security", /Fail closed, least privilege/],
      ["Open source", /What AEGIS builds on/],
      ["Pricing", /Enterprise licensing/],
      ["Contact", /Talk to the team/],
    ];
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" }).first();
    for (const [label, heading] of expected) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
    await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
    await page.waitForURL(/\/login/);
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Request a demo" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/See the gateway decide/);
  });

  test("footer links reach legal pages", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy notice");
    await expect(page.getByText("Draft for review by counsel").first()).toBeVisible();
    await page.getByRole("contentinfo").getByRole("link", { name: "Terms" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of use");
  });

  test("tour slider changes the deciding rule at 300, 1200 and 5000", async ({ page }) => {
    await page.goto("/site/tour");
    await expect(page.getByText("Illustration of the live flow; thresholds are customer-configurable examples.", { exact: false })).toBeVisible();
    const slider = page.getByTestId("refund-slider");
    const rule = page.getByTestId("refund-rule");
    const outcome = page.getByTestId("refund-outcome");
    await slider.fill("300");
    await expect(rule).toHaveText("autonomous-under-500");
    await expect(outcome).toContainText("Allowed");
    await slider.fill("1200");
    await expect(rule).toHaveText("supervisor-500-2500");
    await expect(outcome).toContainText("Approval required");
    await slider.fill("5000");
    await expect(rule).toHaveText("deny-over-2500");
    await expect(outcome).toContainText("Denied");
  });

  test("tour walkthrough steps through the banking scenario", async ({ page }) => {
    await page.goto("/site/tour");
    const steps = page.getByRole("list", { name: "Tour steps" }).getByRole("button");
    await expect(steps).toHaveCount(6);
    await steps.nth(2).click();
    await expect(page.getByRole("heading", { level: 3, name: /202: approval required/ })).toBeVisible();
    await steps.nth(4).click();
    await expect(page.getByText("TRF-0192F0C4")).toBeVisible();
    await page.getByRole("link", { name: "Sign in to the console for the live demo" }).click();
    await page.waitForURL(/\/login/);
  });

  test("demo form submits and shows a confirmation", async ({ page }) => {
    await page.goto("/site/demo");
    await page.getByLabel("Full name").fill("Playwright Tester");
    await page.getByLabel("Work email").fill(`e2e-${Date.now()}@example.com`);
    await page.getByLabel("Organization").fill("E2E Test Organization");
    await page.getByLabel("Role").fill("Head of Risk");
    await page.getByLabel("Area of interest").selectOption("Whole platform");
    await page.getByLabel("Deployment preference").selectOption("Private deployment (Kubernetes)");
    await page.getByLabel("Preferred dates").fill("Week of 3 November, mornings");
    await page.getByLabel(/Message/).fill("Automated end-to-end test submission.");
    await page.getByRole("button", { name: "Request a demo" }).click();
    const confirmation = page.getByTestId("form-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("Demo request received");
    await expect(confirmation).toContainText("A person will reply by email");
    await expect(confirmation).toContainText(/Your reference is [0-9A-F]{8}\./);
  });

  test("contact form validates required fields", async ({ page }) => {
    await page.goto("/site/contact");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("form-confirmation")).toHaveCount(0);
  });

  test("contact honeypot submission is accepted silently without a reference", async ({ page }) => {
    await page.goto("/site/contact");
    await page.getByLabel("Full name").fill("Bot Submitter");
    await page.getByLabel("Work email").fill("bot@example.com");
    await page.getByLabel("Organization").fill("Bots Inc");
    await page.getByLabel("Role").fill("Crawler");
    await page.getByLabel("Area of interest").selectOption("Other");
    await page.getByTestId("honeypot").evaluate((el) => {
      (el as HTMLInputElement).value = "https://spam.example";
    });
    await page.getByRole("button", { name: "Send message" }).click();
    const confirmation = page.getByTestId("form-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).not.toContainText("Your reference is");
  });

  test("no page contains forbidden claim strings", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const text = await page.locator("body").innerText();
      for (const s of FORBIDDEN) {
        expect(text.toLowerCase(), `${path} contains "${s}"`).not.toContain(s.toLowerCase());
      }
    }
  });

  test("robots and sitemap are served", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("sitemap.xml");
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("/site/tour");
  });

  test("home is usable at 360px wide", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Security", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Fail closed/);
  });
});
