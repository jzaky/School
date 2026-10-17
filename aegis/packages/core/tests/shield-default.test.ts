import { describe, expect, it } from "vitest";
import { getShieldInspector, isShieldInspectorRegistered } from "../src/gateway/shield-hook.js";
import { shieldInspector } from "../src/shield/inspector.js";
import { withTenant } from "@aegis/db";
import { makeTestTenant } from "./helpers.js";
import { ensureDefaultDataClasses } from "../src/shield/data-classes.js";

/**
 * Regression: the gateway must inspect parameters even when installShield() was never called in
 * this process. A no-op default would silently disable data protection in any bundle that keeps a
 * separate module instance (Next.js server actions versus instrumentation).
 */
describe("shield default", () => {
  it("falls back to the real inspector when nothing was registered", async () => {
    const t = await makeTestTenant("shield-default");
    try {
      expect(isShieldInspectorRegistered()).toBe(false);
      await withTenant(t.orgId, (db) => ensureDefaultDataClasses(db, t.ownerCtx));
      const inspect = getShieldInspector();
      const result = await withTenant(t.orgId, (db) => inspect(db, t.orgId, { params: { note: "card 4111 1111 1111 1111" }, toolKey: "send-email", destinationDomain: null, agentId: "00000000-0000-7000-8000-000000000000" }), { readOnly: true });
      expect(result.shield.dataClasses).toContain("card_number");
      expect(getShieldInspector()).toBe(shieldInspector);
    } finally {
      await t.cleanup();
    }
  });
});
