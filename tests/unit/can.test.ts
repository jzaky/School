import { describe, expect, it } from "vitest";
import { can, canAny, hasRole, permissionsOf } from "@/server/identity/can";
import { PERMISSIONS, SYSTEM_ROLES } from "@/server/identity/permissions";

function member(keys: string[], status = "ACTIVE") {
  return {
    status,
    roles: keys.map((k) => {
      const def = SYSTEM_ROLES.find((r) => r.key === k)!;
      return { role: { key: def.key, permissions: def.permissions } };
    }),
  };
}

describe("can()", () => {
  it("grants permissions from the membership's roles", () => {
    expect(can(member(["school_admin"]), "services.manage")).toBe(true);
    expect(can(member(["teacher"]), "services.manage")).toBe(false);
  });

  it("every staff role can refer a safeguarding concern", () => {
    for (const r of SYSTEM_ROLES) {
      if (r.key === "student" || r.key === "parent") continue;
      expect(can(member([r.key]), "safeguarding.refer")).toBe(true);
    }
  });

  it("only DSL and deputy DSL can view safeguarding cases", () => {
    const viewers = SYSTEM_ROLES.filter((r) => r.permissions.includes("safeguarding.view")).map((r) => r.key);
    expect(viewers.sort()).toEqual(["deputy_dsl", "dsl"]);
  });

  it("only the DSL can export safeguarding records", () => {
    const exporters = SYSTEM_ROLES.filter((r) => r.permissions.includes("safeguarding.export")).map((r) => r.key);
    expect(exporters).toEqual(["dsl"]);
  });

  it("principal has break-glass but not routine safeguarding access", () => {
    const p = member(["principal"]);
    expect(can(p, "safeguarding.break_glass")).toBe(true);
    expect(can(p, "safeguarding.view")).toBe(false);
  });

  it("parents and students never get staff case access", () => {
    for (const k of ["parent", "student"]) {
      const m = member([k]);
      expect(canAny(m, ["cases.view", "cases.manage", "safeguarding.view", "people.view"])).toBe(false);
    }
  });

  it("combines permissions across several roles", () => {
    const m = member(["teacher", "department_head"]);
    expect(hasRole(m, "department_head")).toBe(true);
    expect(can(m, "cases.manage")).toBe(true);
  });

  it("suspended or missing memberships have no permissions", () => {
    expect(can(member(["school_admin"], "SUSPENDED"), "admin.access")).toBe(false);
    expect(can(null, "services.use")).toBe(false);
    expect(permissionsOf(undefined).size).toBe(0);
  });

  it("role definitions only use known permission keys", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(known.has(p)).toBe(true);
  });
});
