import { afterEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, personaPassword } from "../src/seed/demo-tenant.js";

/** Staging and pentest targets must not accept the published demo password (docs/STAGING_FLY.md, step 5). */
describe("seed persona password", () => {
  const saved = process.env.AEGIS_SEED_PERSONA_PASSWORD;
  afterEach(() => {
    if (saved === undefined) delete process.env.AEGIS_SEED_PERSONA_PASSWORD;
    else process.env.AEGIS_SEED_PERSONA_PASSWORD = saved;
  });

  it("uses the published demo password when nothing is configured", () => {
    delete process.env.AEGIS_SEED_PERSONA_PASSWORD;
    expect(personaPassword()).toBe(DEMO_PASSWORD);
  });

  it("uses the configured password, so the published one opens nothing", () => {
    process.env.AEGIS_SEED_PERSONA_PASSWORD = "staging-only-long-password";
    expect(personaPassword()).toBe("staging-only-long-password");
    expect(personaPassword()).not.toBe(DEMO_PASSWORD);
  });

  it("refuses a short configured password instead of silently falling back", () => {
    process.env.AEGIS_SEED_PERSONA_PASSWORD = "short";
    expect(() => personaPassword()).toThrow(/at least 12/);
  });
});
