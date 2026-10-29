import { describe, expect, it } from "vitest";
import { trustProxySetting } from "../src/app.js";

describe("forwarded address trust", () => {
  it("trusts only private-network proxies unless configured", () => {
    expect(trustProxySetting(undefined)).toBe("loopback,linklocal,uniquelocal");
    expect(trustProxySetting("")).toBe("loopback,linklocal,uniquelocal");
    expect(trustProxySetting("false")).toBe(false);
    expect(trustProxySetting("true")).toBe(true);
    expect(trustProxySetting("10.0.0.0/8")).toBe("10.0.0.0/8");
  });
});
