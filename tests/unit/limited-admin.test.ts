// Limited admin access: no self-escalation, time-limited assignments, safeguarding alerts and the access report.
import { describe, expect, it } from "vitest";
import {
  accessOf,
  checkAccessChange,
  permanentRolesManagers,
  permissionsBlockedForSelf,
  roleWatchedDelta,
  rolePermissionsBlockedForSelf,
  rolesBlockedForSelf,
  rolesManagers,
  selfEscalation,
  watchedDeltas,
  withAssignmentEnd,
  withMemberRoles,
  withMemberStatus,
  withRole,
  withRolePermissions,
  withoutPermanentRole,
  withoutRole,
  type AccessSnapshot,
} from "@/server/access/guardrails";
import { SAFEGUARDING_WATCHED, SENSITIVE_PERMISSIONS, isSensitivePermission } from "@/server/access/permission-catalog";
import { alertRecipients, describeAccessChange } from "@/server/access/access-alerts";
import { buildAccessReport, reportAreas, type ReportMember } from "@/server/access/report";
import { daysLeft, dubaiDayKey, endOfDubaiDay, parseUntil } from "@/server/access/until";
import { explainAccess } from "@/server/access/roles";
import { SYSTEM_ROLES } from "@/server/identity/permissions";

const NOW = new Date("2026-10-26T08:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const perms = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!.permissions as string[];

// A school with the shipped roles: Aisha (admin), Omar (principal, also manages roles), Khalid (DSL),
// Hannah (wellbeing lead), Daniel (teacher). "custom" is a school-made role nobody holds.
const school: AccessSnapshot = {
  roles: [
    { id: "admin", permissions: perms("school_admin") },
    { id: "principal", permissions: perms("principal") },
    { id: "dsl", permissions: perms("dsl") },
    { id: "deputy", permissions: perms("deputy_dsl") },
    { id: "wellbeing", permissions: perms("wellbeing_lead") },
    { id: "teacher", permissions: perms("teacher") },
    { id: "custom", permissions: ["calendar.manage"] },
  ],
  members: [
    { id: "aisha", status: "ACTIVE", roleIds: ["admin"] },
    { id: "omar", status: "ACTIVE", roleIds: ["principal"] },
    { id: "khalid", status: "ACTIVE", roleIds: ["dsl", "teacher"] },
    { id: "hannah", status: "ACTIVE", roleIds: ["wellbeing"] },
    { id: "daniel", status: "ACTIVE", roleIds: ["teacher"] },
  ],
};

describe("the shipped roles", () => {
  it("give the school administrator no safeguarding, wellbeing or medical access", () => {
    const a = accessOf(school, "aisha", NOW);
    for (const p of ["safeguarding.view", "safeguarding.manage", "safeguarding.export", "safeguarding.break_glass", "cases.wellbeing", "people.medical"]) expect(a.has(p)).toBe(false);
    expect(a.has("roles.manage")).toBe(true);
  });

  it("treat every safeguarding permission as sensitive, including ones added later", () => {
    expect(isSensitivePermission("safeguarding.something_new")).toBe(true);
    for (const p of SAFEGUARDING_WATCHED) expect(SENSITIVE_PERMISSIONS).toContain(p);
  });
});

describe("no self-escalation", () => {
  it("refuses adding a sensitive permission to a role you hold", () => {
    const after = withRolePermissions(school, "admin", [...perms("school_admin"), "safeguarding.view"]);
    expect(selfEscalation(school, after, "aisha", NOW)).toEqual(["safeguarding.view"]);
    expect(checkAccessChange(school, after, "aisha", NOW)).toBe("SELF_ESCALATION");
  });

  it("lets another person who manages roles make the same change", () => {
    const after = withRolePermissions(school, "admin", [...perms("school_admin"), "safeguarding.view"]);
    expect(checkAccessChange(school, after, "omar", NOW)).toBeNull();
  });

  it("refuses adding a sensitive permission to someone else's role only when you hold it too", () => {
    const toTeacher = withRolePermissions(school, "teacher", [...perms("teacher"), "people.medical"]);
    expect(checkAccessChange(school, toTeacher, "aisha", NOW)).toBeNull();
    expect(checkAccessChange(school, toTeacher, "khalid", NOW)).toBe("SELF_ESCALATION");
  });

  it("refuses adding a role to yourself that opens sensitive records", () => {
    expect(checkAccessChange(school, withMemberRoles(school, "aisha", ["admin", "dsl"]), "aisha", NOW)).toBe("SELF_ESCALATION");
    expect(checkAccessChange(school, withMemberRoles(school, "aisha", ["admin", "dsl"]), "omar", NOW)).toBeNull();
  });

  it("allows adding yourself to a role that gives nothing sensitive you lack", () => {
    expect(checkAccessChange(school, withMemberRoles(school, "aisha", ["admin", "teacher"]), "aisha", NOW)).toBeNull();
    expect(checkAccessChange(school, withMemberRoles(school, "aisha", ["admin", "custom"]), "aisha", NOW)).toBeNull();
  });

  it("refuses restoring a role default that would add sensitive access to a role you hold", () => {
    const trimmed = withRolePermissions(school, "principal", perms("principal").filter((p) => p !== "cases.wellbeing"));
    const restored = withRolePermissions(trimmed, "principal", perms("principal"));
    expect(checkAccessChange(trimmed, restored, "omar", NOW)).toBe("SELF_ESCALATION");
    expect(rolePermissionsBlockedForSelf(trimmed, "omar", "principal", perms("principal"), NOW)).toBe(true);
    expect(checkAccessChange(trimmed, restored, "aisha", NOW)).toBeNull();
  });

  it("allows creating a copy of a sensitive role, but not adding yourself to it", () => {
    const copied = withRole(school, { id: "copy", permissions: perms("dsl") });
    expect(checkAccessChange(school, copied, "aisha", NOW)).toBeNull();
    expect(checkAccessChange(copied, withMemberRoles(copied, "aisha", ["admin", "copy"]), "aisha", NOW)).toBe("SELF_ESCALATION");
  });

  it("refuses moving yourself into a sensitive role when a role you hold is deleted", () => {
    const s = withMemberRoles(withRole(school, { id: "it", permissions: ["requests.process"] }), "aisha", ["admin", "it"]);
    const after = withMemberRoles(withoutRole(s, "it"), "aisha", ["admin", "dsl"]);
    expect(checkAccessChange(s, after, "aisha", NOW)).toBe("SELF_ESCALATION");
  });

  it("refuses keeping your own time-limited sensitive access for longer, but allows ending it sooner", () => {
    const s = withMemberRoles(school, "hannah", ["wellbeing", "deputy"], { deputy: day(10) });
    expect(checkAccessChange(s, withAssignmentEnd(s, "hannah", "deputy", day(20)), "hannah", NOW)).toBe("SELF_ESCALATION");
    expect(checkAccessChange(s, withAssignmentEnd(s, "hannah", "deputy", null), "hannah", NOW)).toBe("SELF_ESCALATION");
    expect(checkAccessChange(s, withAssignmentEnd(s, "hannah", "deputy", day(3)), "hannah", NOW)).toBeNull();
    expect(checkAccessChange(s, withMemberRoles(s, "hannah", ["wellbeing"]), "hannah", NOW)).toBeNull();
    // Another person who manages roles can extend it.
    expect(checkAccessChange(s, withAssignmentEnd(s, "hannah", "deputy", day(20)), "aisha", NOW)).toBeNull();
  });

  it("counts making time-limited access permanent through another role as raising it", () => {
    const s = withMemberRoles(school, "hannah", ["wellbeing", "deputy"], { deputy: day(10) });
    expect(selfEscalation(s, withMemberRoles(s, "hannah", ["wellbeing", "deputy", "dsl"]), "hannah", NOW)).toEqual(expect.arrayContaining(["safeguarding.manage", "safeguarding.view"]));
  });

  it("allows lowering your own access, within the lockout rules", () => {
    const lower = withRolePermissions(school, "admin", perms("school_admin").filter((p) => p !== "people.reveal_ids"));
    expect(checkAccessChange(school, lower, "aisha", NOW)).toBeNull();
    const twoManagers = withMemberRoles(school, "daniel", ["teacher", "admin"]);
    expect(checkAccessChange(twoManagers, withMemberRoles(twoManagers, "aisha", ["teacher"]), "aisha", NOW)).toBe("SELF_LOCKOUT");
  });

  it("ignores inactive members and expired assignments", () => {
    const s = withMemberRoles(school, "daniel", ["teacher", "dsl"], { dsl: day(-1) });
    expect(accessOf(s, "daniel", NOW).has("safeguarding.view")).toBe(false);
    expect(accessOf(withMemberStatus(school, "khalid", "SUSPENDED"), "khalid", NOW).size).toBe(0);
  });

  it("tells the UI which roles and permissions not to offer to the viewer", () => {
    expect(rolesBlockedForSelf(school, "aisha", ["dsl", "teacher", "custom", "deputy"], NOW).sort()).toEqual(["deputy", "dsl"]);
    expect(permissionsBlockedForSelf(school, "aisha", "admin", ["safeguarding.view", "people.medical", "calendar.view", "roles.manage"], NOW)).toEqual(["safeguarding.view", "people.medical"]);
    expect(permissionsBlockedForSelf(school, "aisha", "teacher", ["safeguarding.view"], NOW)).toEqual([]);
  });
});

describe("time-limited assignments", () => {
  it("parse an until day as the end of that day in Dubai", () => {
    expect(endOfDubaiDay("2026-11-05")?.toISOString()).toBe("2026-11-05T19:59:59.999Z");
    expect(dubaiDayKey(endOfDubaiDay("2026-11-05")!)).toBe("2026-11-05");
    expect(endOfDubaiDay("2026-02-30")).toBeNull();
    expect(endOfDubaiDay("5/11/2026")).toBeNull();
  });

  it("accept today or later, up to about a year ahead", () => {
    expect(parseUntil("2026-10-26", NOW)).toMatchObject({ ok: true });
    expect(parseUntil("2026-10-25", NOW)).toEqual({ ok: false, error: "PAST_DATE" });
    expect(parseUntil("2028-01-01", NOW)).toEqual({ ok: false, error: "TOO_FAR" });
    expect(parseUntil("tomorrow", NOW)).toEqual({ ok: false, error: "INVALID_DATE" });
  });

  it("count days left in the school's calendar", () => {
    expect(daysLeft(endOfDubaiDay("2026-11-05")!, NOW)).toBe(10);
    expect(daysLeft(endOfDubaiDay("2026-10-26")!, NOW)).toBe(0);
  });

  it("stop granting access after the end date", () => {
    const s = withMemberRoles(school, "daniel", ["teacher", "deputy"], { deputy: endOfDubaiDay("2026-11-05") });
    expect(accessOf(s, "daniel", NOW).has("safeguarding.view")).toBe(true);
    expect(accessOf(s, "daniel", new Date("2026-11-05T20:00:00Z")).has("safeguarding.view")).toBe(false);
    const m = { status: "ACTIVE", roles: [{ expiresAt: day(-1), role: { key: "deputy_dsl", permissions: ["safeguarding.view"] } }, { expiresAt: null, role: { key: "teacher", permissions: ["grades.enter"] } }] };
    expect(explainAccess(m, NOW).has("safeguarding.view")).toBe(false);
    expect(explainAccess(m, NOW).get("grades.enter")).toEqual(["teacher"]);
  });

  it("keep at least one role that does not expire", () => {
    const after = withMemberRoles(school, "daniel", ["teacher"], { teacher: day(5) });
    expect(withoutPermanentRole(after, ["daniel"])).toEqual(["daniel"]);
    expect(checkAccessChange(school, after, "aisha", NOW, ["daniel"])).toBe("NEEDS_PERMANENT_ROLE");
    const ok = withMemberRoles(school, "daniel", ["teacher", "deputy"], { deputy: day(5) });
    expect(checkAccessChange(school, ok, "aisha", NOW, ["daniel"])).toBeNull();
    expect(checkAccessChange(ok, withMemberRoles(ok, "daniel", ["deputy"]), "aisha", NOW, ["daniel"])).toBe("NEEDS_PERMANENT_ROLE");
  });

  it("never let the only permanent role manager's access run out", () => {
    const solo: AccessSnapshot = { roles: school.roles, members: [{ id: "aisha", status: "ACTIVE", roleIds: ["admin", "teacher"] }, { id: "daniel", status: "ACTIVE", roleIds: ["teacher"] }] };
    const ending = withAssignmentEnd(solo, "aisha", "admin", day(5));
    expect(rolesManagers(ending, NOW)).toEqual(["aisha"]);
    expect(permanentRolesManagers(ending, NOW)).toEqual([]);
    expect(checkAccessChange(solo, ending, "daniel", NOW)).toBe("LAST_ROLES_MANAGER");
    const two = withMemberRoles(solo, "daniel", ["teacher", "admin"]);
    expect(checkAccessChange(two, withAssignmentEnd(two, "aisha", "admin", day(5)), "aisha", NOW)).toBe("SELF_LOCKOUT");
    expect(checkAccessChange(two, withAssignmentEnd(two, "aisha", "admin", day(5)), "daniel", NOW)).toBeNull();
  });
});

describe("safeguarding access alerts", () => {
  it("find who gained, lost or kept watched access for longer", () => {
    const gained = withMemberRoles(school, "daniel", ["teacher", "deputy"], { deputy: day(10) });
    expect(watchedDeltas(school, gained, ["daniel"], SAFEGUARDING_WATCHED, NOW)).toEqual([
      { membershipId: "daniel", gained: ["safeguarding.view", "safeguarding.manage", "cases.wellbeing"], lost: [], longer: [], shorter: [] },
    ]);
    const extended = withAssignmentEnd(gained, "daniel", "deputy", day(20));
    expect(watchedDeltas(gained, extended, ["daniel"], SAFEGUARDING_WATCHED, NOW)[0].longer).toEqual(["safeguarding.view", "safeguarding.manage", "cases.wellbeing"]);
    // The expiry job looks at "before" just before the end date.
    const removed = withMemberRoles(gained, "daniel", ["teacher"]);
    expect(watchedDeltas(gained, removed, ["daniel"], SAFEGUARDING_WATCHED, day(11), day(9))[0].lost).toEqual(["safeguarding.view", "safeguarding.manage", "cases.wellbeing"]);
    // Changes that do not touch watched permissions send nothing.
    expect(watchedDeltas(school, withMemberRoles(school, "daniel", ["teacher", "custom"]), ["daniel"], SAFEGUARDING_WATCHED, NOW)).toEqual([]);
    expect(roleWatchedDelta(["a"], ["a", "safeguarding.export"], SAFEGUARDING_WATCHED)).toEqual({ gained: ["safeguarding.export"], lost: [] });
  });

  it("tell the safeguarding managers, never the person who made the change, else the principal", () => {
    expect(alertRecipients(["khalid", "richard"], ["omar"], "aisha")).toEqual({ to: ["khalid", "richard"], fallback: false });
    expect(alertRecipients(["khalid", "richard"], ["omar"], "khalid")).toEqual({ to: ["richard"], fallback: false });
    expect(alertRecipients(["khalid"], ["omar"], "khalid")).toEqual({ to: ["omar"], fallback: true });
    expect(alertRecipients([], ["omar"], null)).toEqual({ to: ["omar"], fallback: true });
  });

  it("say who changed what in both languages, with no case details", () => {
    const after = withMemberRoles(school, "hannah", ["wellbeing", "deputy"], { deputy: endOfDubaiDay("2026-11-05") });
    const deltas = watchedDeltas(school, after, ["hannah"], SAFEGUARDING_WATCHED, NOW);
    const text = describeAccessChange(deltas, new Map([["hannah", { en: "Hannah Morrison", ar: "هانا موريسون" }]]), after, [], NOW);
    expect(text.en).toBe("New access for Hannah Morrison: see safeguarding cases, manage safeguarding cases (until 5 Nov 2026).");
    expect(text.ar).toContain("هانا موريسون");
    expect(text.ar).toContain("الاطلاع على ملفات الحماية");
    const role = describeAccessChange([], new Map(), school, [{ name: { en: "Teacher", ar: "معلم" }, before: ["grades.enter"], after: ["grades.enter", "cases.wellbeing"], holders: 41 }], NOW);
    expect(role.en).toBe("The role Teacher now gives: see wellbeing cases (people with this role: 41).");
    expect(`${text.en}${role.en}`).not.toMatch(/\u2014/);
  });
});

describe("access report", () => {
  const role = (id: string, key: string, permissions: string[]) => ({ id, key, nameEn: key, nameAr: key, permissions });
  const members: ReportMember[] = [
    { id: "khalid", status: "ACTIVE", lastSeenAt: day(-1), user: { nameEn: "Khalid Yousef", nameAr: null, email: "k@x.test" }, roles: [{ roleId: "dsl", expiresAt: null, role: role("dsl", "dsl", perms("dsl")) }] },
    {
      id: "hannah",
      status: "ACTIVE",
      lastSeenAt: null,
      user: { nameEn: "Hannah Morrison", nameAr: null, email: "h@x.test" },
      roles: [
        { roleId: "wellbeing", expiresAt: null, role: role("wellbeing", "wellbeing_lead", perms("wellbeing_lead")) },
        { roleId: "deputy", expiresAt: day(10), role: role("deputy", "deputy_dsl", perms("deputy_dsl")) },
      ],
    },
    { id: "gone", status: "ACTIVE", lastSeenAt: null, user: { nameEn: "Old Cover", nameAr: null, email: "o@x.test" }, roles: [{ roleId: "deputy", expiresAt: day(-2), role: role("deputy", "deputy_dsl", perms("deputy_dsl")) }] },
    { id: "away", status: "SUSPENDED", lastSeenAt: null, user: { nameEn: "Suspended Person", nameAr: null, email: "s@x.test" }, roles: [{ roleId: "dsl", expiresAt: null, role: role("dsl", "dsl", perms("dsl")) }] },
  ];

  it("lists who can see safeguarding records, the granting role and when it ends", () => {
    const report = buildAccessReport(members, NOW);
    const sg = report.find((a) => a.key === "safeguarding")!;
    expect(sg.entries.map((e) => e.membershipId)).toEqual(["hannah", "khalid"]);
    const hannah = sg.entries.find((e) => e.membershipId === "hannah")!;
    expect(hannah.until?.toISOString()).toBe(day(10).toISOString());
    expect(hannah.via.map((v) => v.key)).toEqual(["deputy_dsl"]);
    expect(sg.entries.find((e) => e.membershipId === "khalid")!.until).toBeNull();
    // Wellbeing access through a permanent role is permanent, even with time-limited cover on top.
    expect(report.find((a) => a.key === "wellbeing")!.entries.find((e) => e.membershipId === "hannah")!.until).toBeNull();
  });

  it("covers every sensitive permission in the catalog, including ones added later", () => {
    const covered = reportAreas().flatMap((a) => a.permissions);
    for (const p of SENSITIVE_PERMISSIONS.filter((p) => p !== "safeguarding.refer")) expect(covered).toContain(p);
    const later = reportAreas([...covered, "fees.refund"].concat(["safeguarding.new_thing"]));
    expect(later.find((a) => a.key === "other")?.permissions).toEqual(["safeguarding.new_thing"]);
  });
});
