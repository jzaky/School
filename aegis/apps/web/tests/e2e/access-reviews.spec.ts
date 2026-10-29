import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const MANAGER = "omar.farouk@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("agent access reviews", () => {
  test("a viewer sees the open review and last quarter's record but cannot decide", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto("/agents/access-reviews");
    await expect(page.getByRole("heading", { name: "Access Reviews" })).toBeVisible();
    await expect(page.getByText("Q4 agent access review")).toBeVisible();
    await expect(page.getByTestId("past-review").filter({ hasText: "Q3 agent access review" })).toContainText("On time");
    await expect(page.getByTestId("review-item").first().getByRole("button", { name: "Keep" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start review" })).toBeDisabled();
  });

  test("the governance manager keeps one grant, and the decision shows", async ({ page }) => {
    await login(page, MANAGER);
    await page.goto("/agents/access-reviews");
    const before = await page.getByTestId("review-item").filter({ hasText: "Kept" }).count();
    const row = page.getByTestId("review-item").filter({ has: page.getByRole("button", { name: "Keep" }) }).first();
    await row.getByRole("button", { name: "Keep" }).click();
    await expect(page.getByTestId("review-item").filter({ hasText: "Kept" })).toHaveCount(before + 1);
  });
});
