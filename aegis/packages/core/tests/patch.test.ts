import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { z } from "zod";
import { makeTestTenant, type TestTenant } from "./helpers.js";
import { parsePatch } from "../src/lib/patch.js";
import { createAgent, updateAgent } from "../src/agents/registry.js";

describe("partial updates keep fields the caller did not send", () => {
  it("drops defaults zod would otherwise fill in, and still validates what was sent", () => {
    const schema = z.object({ name: z.string().min(2), tier: z.string().default("low"), tags: z.array(z.string()).default([]) });
    expect(parsePatch(schema, { name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(parsePatch(schema, { tier: "high", name: undefined })).toEqual({ tier: "high" });
    expect(() => parsePatch(schema, { name: "x" })).toThrow();
  });

  describe("agent edits", () => {
    let t: TestTenant;
    beforeAll(async () => {
      t = await makeTestTenant("patch");
    }, 60_000);
    afterAll(async () => {
      await t.cleanup();
      await disconnectAll();
    });

    it("renaming an agent leaves its data classification limit and risk tier unchanged", async () => {
      const agent = await withTenant(t.orgId, (db) => createAgent(db, t.ownerCtx, { slug: "patch-agent", name: "Patch agent", description: "", environment: "production", dataClassificationLimit: "confidential", riskTier: "high" }));
      const updated = await withTenant(t.orgId, (db) => updateAgent(db, t.ownerCtx, agent.id, { name: "Patch agent renamed" }));
      expect(updated.name).toBe("Patch agent renamed");
      expect(updated.dataClassificationLimit).toBe("confidential");
      expect(updated.riskTier).toBe("high");
      expect(updated.environment).toBe("production");
    });
  });
});
