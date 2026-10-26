import { describe, expect, it } from "vitest";
import { redirectTo } from "@/lib/redirect";

describe("redirectTo", () => {
  it("answers with a relative Location, so the proxy's internal address never leaks", () => {
    const res = redirectTo("/en/home");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/en/home");
  });

  it("refuses anything that is not a path on this site", () => {
    expect(() => redirectTo("https://example.com/")).toThrow();
    expect(() => redirectTo("//example.com/")).toThrow();
    expect(() => redirectTo("en/home")).toThrow();
  });
});
