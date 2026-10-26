import { expect, test } from "@playwright/test";

// Short links and the installed app's start page must redirect within this site. Behind the hosting proxy an
// absolute URL built from the request points at the container (0.0.0.0:3000) and the link goes nowhere.
for (const path of ["/app", "/choose/TEST123"]) {
  test(`redirect stays on this site: ${path}`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = res.headers()["location"] ?? "";
    expect(location).not.toContain("0.0.0.0");
    expect(location.startsWith("/") || location.startsWith(new URL(res.url()).origin)).toBe(true);
  });
}
