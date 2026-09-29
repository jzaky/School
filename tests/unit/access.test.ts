import { describe, expect, it } from "vitest";
import { generateJoinCode, generateToken, hashToken, inviteExpiry, inviteState, isUsable, looksLikeToken, normalizeJoinCode, INVITE_TTL_DAYS } from "@/server/access/tokens";
import {
  PERMISSION_GROUPS,
  SENSITIVE_PERMISSIONS,
  audienceOfRole,
  disallowedPermissions,
  isSensitivePermission,
  permissionAllowedFor,
  permissionsForAudience,
} from "@/server/access/permission-catalog";
import { checkAccessChange, rolesManagers, withMemberRoles, withRolePermissions, withoutRole, type AccessSnapshot } from "@/server/access/guardrails";
import { PERMISSIONS, SYSTEM_ROLES } from "@/server/identity/permissions";
import { encodeQr, qrSvgPath } from "@/server/access/qr";
import { cleanClaim, matchClaim } from "@/server/access/join";
import { matchHints } from "@/server/access/join-requests";
import { confirmMatches, explainAccess } from "@/server/access/roles";
import { cleanDomains } from "@/server/access/invitations";

describe("invitation tokens", () => {
  it("are random, URL safe and stored only as a hash", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(looksLikeToken(a)).toBe(true);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });

  it("rejects junk before it reaches the database", () => {
    expect(looksLikeToken("abc")).toBe(false);
    expect(looksLikeToken("x".repeat(40) + "'; drop")).toBe(false);
  });

  it("expire after 14 days and report their state", () => {
    const now = new Date("2026-09-01T08:00:00Z");
    const expiresAt = inviteExpiry(now);
    expect(INVITE_TTL_DAYS).toBe(14);
    expect(expiresAt.getTime() - now.getTime()).toBe(14 * 86_400_000);
    const inv = { revokedAt: null, expiresAt, uses: 0, maxUses: 1 };
    expect(inviteState(inv, new Date("2026-09-14T08:00:00Z"))).toBe("PENDING");
    expect(isUsable(inv, new Date("2026-09-14T08:00:00Z"))).toBe(true);
    expect(inviteState(inv, new Date("2026-09-15T08:00:00Z"))).toBe("EXPIRED");
    expect(inviteState({ ...inv, uses: 1 }, now)).toBe("ACCEPTED");
    expect(inviteState({ ...inv, revokedAt: now }, now)).toBe("REVOKED");
    expect(inviteState({ ...inv, maxUses: 25, uses: 24 }, now)).toBe("PENDING");
  });

  it("makes readable join codes and ignores case, spaces and dashes", () => {
    const code = generateJoinCode("Horizon");
    expect(code).toMatch(/^HRZ-[A-HJ-NP-Z2-9]{5}$/);
    expect(normalizeJoinCode(" hrz - 7k4qx ")).toBe("HRZ7K4QX");
    expect(normalizeJoinCode(code.toLowerCase())).toBe(code.replace("-", ""));
    expect(normalizeJoinCode("x")).toBe("");
  });
});

describe("permission audiences", () => {
  it("puts every permission in exactly one group", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("keeps every built-in role within its audience", () => {
    for (const r of SYSTEM_ROLES) {
      expect(disallowedPermissions(audienceOfRole(r.key), r.permissions), r.key).toEqual([]);
    }
  });

  it("never lets parents or students receive staff permissions", () => {
    for (const p of ["cases.manage", "safeguarding.view", "people.view", "roles.manage", "grades.enter", "requests.view_all"]) {
      expect(permissionAllowedFor("parent", p)).toBe(false);
      expect(permissionAllowedFor("student", p)).toBe(false);
      expect(permissionAllowedFor("staff", p)).toBe(true);
    }
    expect(permissionAllowedFor("parent", "trips.consent")).toBe(true);
    expect(permissionAllowedFor("student", "trips.consent")).toBe(false);
    expect(permissionAllowedFor("staff", "family.portal")).toBe(false);
    expect(permissionsForAudience("parent")).toContain("family.portal");
  });

  it("marks safeguarding, wellbeing, medical, identity, audit and role management as sensitive", () => {
    for (const p of ["safeguarding.view", "safeguarding.manage", "safeguarding.export", "safeguarding.break_glass", "cases.wellbeing", "people.medical", "people.reveal_ids", "audit.view", "roles.manage"]) {
      expect(isSensitivePermission(p), p).toBe(true);
    }
    expect(isSensitivePermission("grades.enter")).toBe(false);
    expect(SENSITIVE_PERMISSIONS.length).toBeGreaterThanOrEqual(9);
  });

  it("asks for the role name as typed confirmation", () => {
    const role = { nameEn: "Designated Safeguarding Lead", nameAr: "مسؤول حماية الطفل المعيّن" };
    expect(confirmMatches("designated  safeguarding lead", role)).toBe(true);
    expect(confirmMatches("مسؤول حماية الطفل المعيّن", role)).toBe(true);
    expect(confirmMatches("yes", role)).toBe(false);
    expect(confirmMatches("", role)).toBe(false);
  });
});

describe("last admin guardrail", () => {
  const base: AccessSnapshot = {
    roles: [
      { id: "admin", permissions: ["roles.manage", "people.manage"] },
      { id: "teacher", permissions: ["grades.enter"] },
    ],
    members: [
      { id: "aisha", status: "ACTIVE", roleIds: ["admin"] },
      { id: "daniel", status: "ACTIVE", roleIds: ["teacher"] },
      { id: "old", status: "SUSPENDED", roleIds: ["admin"] },
    ],
  };

  it("counts only active people who can manage roles", () => {
    expect(rolesManagers(base)).toEqual(["aisha"]);
  });

  it("blocks removing roles.manage from the last active person who has it", () => {
    const after = withRolePermissions(base, "admin", ["people.manage"]);
    expect(checkAccessChange(base, after, "someone-else")).toBe("LAST_ROLES_MANAGER");
    expect(checkAccessChange(base, withMemberRoles(base, "aisha", ["teacher"]), "daniel")).toBe("LAST_ROLES_MANAGER");
    expect(checkAccessChange(base, withoutRole(base, "admin"), "daniel")).toBe("LAST_ROLES_MANAGER");
  });

  it("blocks removing your own last admin role even when others remain", () => {
    const two = withMemberRoles(base, "daniel", ["teacher", "admin"]);
    expect(checkAccessChange(two, withMemberRoles(two, "aisha", ["teacher"]), "aisha")).toBe("SELF_LOCKOUT");
    expect(checkAccessChange(two, withMemberRoles(two, "aisha", ["teacher"]), "daniel")).toBeNull();
  });

  it("allows ordinary changes", () => {
    expect(checkAccessChange(base, withRolePermissions(base, "teacher", ["grades.enter", "trips.manage"]), "aisha")).toBeNull();
    expect(checkAccessChange(base, withMemberRoles(base, "daniel", ["teacher", "admin"]), "aisha")).toBeNull();
  });

  it("explains which role grants each permission and gives nothing to inactive members", () => {
    const m = { status: "ACTIVE", roles: [{ role: { key: "teacher", permissions: ["grades.enter", "calendar.view"] } }, { role: { key: "hod", permissions: ["grades.enter"] } }] };
    expect(explainAccess(m).get("grades.enter")).toEqual(["teacher", "hod"]);
    expect(explainAccess({ ...m, status: "PENDING_APPROVAL" }).size).toBe(0);
  });
});

describe("child claims", () => {
  const students = [
    { id: "s1", studentNo: "HIS-24001", dateOfBirth: new Date("2012-03-01T00:00:00Z"), gradeLevel: 9, firstNameEn: "Adam", lastNameEn: "Nasser", firstNameAr: "آدم", lastNameAr: "ناصر", preferredName: null },
    { id: "s2", studentNo: "HIS-24002", dateOfBirth: new Date("2015-08-12T00:00:00Z"), gradeLevel: 6, firstNameEn: "Yara", lastNameEn: "Nasser", firstNameAr: "يارا", lastNameAr: "ناصر", preferredName: null },
  ];

  it("matches by student number and date of birth, or by grade and full name", () => {
    expect(matchClaim(cleanClaim({ studentNo: "his-24001", dateOfBirth: "2012-03-01" })!, students)).toBe("s1");
    expect(matchClaim(cleanClaim({ grade: 6, fullName: "yara  nasser" })!, students)).toBe("s2");
    expect(matchClaim(cleanClaim({ grade: 6, fullName: "يارا ناصر" })!, students)).toBe("s2");
  });

  it("does not match wrong details", () => {
    expect(matchClaim(cleanClaim({ studentNo: "HIS-24001", dateOfBirth: "2012-03-02" })!, students)).toBeNull();
    expect(matchClaim(cleanClaim({ grade: 7, fullName: "Yara Nasser" })!, students)).toBeNull();
    expect(cleanClaim({ studentNo: "HIS-24001" })).toBeNull();
    expect(cleanClaim({ grade: 6, fullName: "Yara" })).toBeNull();
  });

  it("gives admins hints about near matches", () => {
    const hints = matchHints({ studentNo: "HIS-24001", dateOfBirth: "2012-03-09" }, students);
    expect(hints[0]).toMatchObject({ studentId: "s1", exact: false });
    expect(hints[0].reasons).toContain("STUDENT_NO");
    const byName = matchHints({ grade: 6, fullName: "Yara Nasser" }, students);
    expect(byName[0]).toMatchObject({ studentId: "s2", exact: true });
  });
});

describe("join settings", () => {
  it("accepts school domains and refuses public email providers", () => {
    expect(cleanDomains(["@Horizon.sch.ae", "horizon.sch.ae", " staff.horizon.example "])).toEqual({ domains: ["horizon.sch.ae", "staff.horizon.example"], problem: null });
    expect(cleanDomains(["gmail.com"]).problem).toBe("PUBLIC_DOMAIN");
    expect(cleanDomains(["not a domain"]).problem).toBe("DOMAIN");
  });
});

describe("QR code", () => {
  it("encodes a join link into a valid-size symbol with finder patterns", () => {
    const m = encodeQr("https://school.example/join?code=HRZ-7K4QX");
    expect([21, 25, 29, 33, 37, 41, 45, 49, 53, 57]).toContain(m.length);
    // Top-left finder: dark border ring, light ring, dark core.
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[1][1]).toBe(false);
    expect(m[3][3]).toBe(true);
    expect(qrSvgPath(m).size).toBe(m.length + 8);
    expect(() => encodeQr("x".repeat(400))).toThrow();
  });
});
