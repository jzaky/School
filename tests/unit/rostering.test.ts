// Rostering rules that need no database: grade codes (KG1 and KG2), role spellings, options, OneRoster and Clever
// record mapping, hashing, OAuth 1.0a signing (checked against an independent implementation) and CSV zips.
import { describe, expect, it } from "vitest";
import { createZip } from "@/lib/zip";
import { DEFAULT_GRADE_MAP, gradeLevelFor, normalizeFeedRole, normalizeGradeCode, readOptions, removalBlocked } from "@/lib/rostering/options";
import { cleverSection, cleverUser, oneRosterClass, oneRosterEnrollment, oneRosterUser, recordHash, relationshipLabel } from "@/lib/rostering/records";
import { oauth1Header, pct } from "@/server/rostering/client";
import { CsvRosterError, parseOneRosterZip, readZipGuarded } from "@/server/rostering/csv";

describe("grade codes", () => {
  it("normalizes OneRoster and Clever spellings", () => {
    expect(normalizeGradeCode("09")).toBe("09");
    expect(normalizeGradeCode("9")).toBe("09");
    expect(normalizeGradeCode("Grade 11")).toBe("11");
    expect(normalizeGradeCode("Kindergarten")).toBe("KG");
    expect(normalizeGradeCode("PreKindergarten")).toBe("PK");
    expect(normalizeGradeCode("TransitionalKindergarten")).toBe("TK");
    expect(normalizeGradeCode("pk")).toBe("PK");
    expect(normalizeGradeCode("")).toBeNull();
  });

  it("maps PK to KG1, KG to KG2 and 01 to 12 by default, and never guesses the rest", () => {
    expect(gradeLevelFor("PK", DEFAULT_GRADE_MAP)).toBe(-1);
    expect(gradeLevelFor("KG", DEFAULT_GRADE_MAP)).toBe(0);
    expect(gradeLevelFor("01", DEFAULT_GRADE_MAP)).toBe(1);
    expect(gradeLevelFor("12", DEFAULT_GRADE_MAP)).toBe(12);
    for (const c of ["TK", "PR", "IT", "13", "PS", "UG", "Other", "K"]) expect(gradeLevelFor(c, DEFAULT_GRADE_MAP)).toBeNull();
  });

  it("lets a school map its own codes, within KG1 to Grade 12", () => {
    const o = readOptions({ gradeMap: { ...DEFAULT_GRADE_MAP, TK: -1, PK: null, "13": 13, "Grade 3": 3 } });
    expect(gradeLevelFor("TK", o.gradeMap)).toBe(-1);
    expect(gradeLevelFor("PK", o.gradeMap)).toBeNull();
    expect(gradeLevelFor("13", o.gradeMap)).toBeNull();
    expect(gradeLevelFor("03", o.gradeMap)).toBe(3);
  });
});

describe("options and roles", () => {
  it("normalizes role spellings across OneRoster 1.1, 1.2 and Clever", () => {
    expect(normalizeFeedRole("teacher")).toBe("teacher");
    expect(normalizeFeedRole("districtAdministrator")).toBe("administrator");
    expect(normalizeFeedRole("district_admin")).toBe("administrator");
    expect(normalizeFeedRole("contact")).toBe("relative");
    expect(normalizeFeedRole("Guardian")).toBe("guardian");
    expect(normalizeFeedRole("wizard")).toBeNull();
  });

  it("reads stored options safely, with defaults", () => {
    const o = readOptions({ importGuardians: false, roleMap: { teacher: "teacher", administrator: "registrar", aide: "Bad Key!" }, removalLimitPercent: 400 });
    expect(o.importGuardians).toBe(false);
    expect(o.importDemographics).toBe(false);
    expect(o.roleMap).toMatchObject({ teacher: "teacher", administrator: "registrar", aide: "teacher" });
    expect(o.removalLimitPercent).toBe(10);
  });

  it("stops large removals but not small ones", () => {
    expect(removalBlocked(5, 10, 10)).toBe(false);
    expect(removalBlocked(6, 1000, 10)).toBe(false);
    expect(removalBlocked(150, 1000, 10)).toBe(true);
    expect(removalBlocked(6, 20, 10)).toBe(true);
  });
});

describe("record mapping", () => {
  it("reads a OneRoster 1.1 student with grades, parents and schools", () => {
    const r = oneRosterUser({ sourcedId: "u1", status: "active", enabledUser: "true", role: "student", givenName: " Adam ", familyName: "Nasser", email: "ADAM@school.test", identifier: "HIS-1", grades: ["09"], orgs: [{ sourcedId: "o1", type: "org" }], agents: [{ sourcedId: "p1", type: "user" }] })!;
    expect(r.kind).toBe("user");
    expect(r.data).toMatchObject({ id: "u1", role: "student", givenName: "Adam", email: "adam@school.test", identifier: "HIS-1", grades: ["09"], orgIds: ["o1"], agentIds: ["p1"], enabled: true });
  });

  it("reads a OneRoster 1.2 user's primary role and CSV-style id lists", () => {
    const r = oneRosterUser({ sourcedId: "u2", status: "tobedeleted", roles: [{ roleType: "secondary", role: "aide", org: { sourcedId: "o2" } }, { roleType: "primary", role: "teacher", org: { sourcedId: "o1" } }], givenName: "Hana", familyName: "Karimi", agentSourcedIds: "a, b" })!;
    expect(r.data).toMatchObject({ role: "teacher", status: "tobedeleted", agentIds: ["a", "b"] });
    expect((r.data as { orgIds: string[] }).orgIds.sort()).toEqual(["o1", "o2"]);
  });

  it("reads classes and enrollments", () => {
    const c = oneRosterClass({ sourcedId: "c1", title: "Mathematics 9A", classType: "homeroom", grades: ["KG"], course: { sourcedId: "co1" }, school: { sourcedId: "o1" }, terms: [{ sourcedId: "t1" }], location: "B-2" })!;
    expect(c.data).toMatchObject({ homeroom: true, grades: ["KG"], courseId: "co1", orgId: "o1", termIds: ["t1"], location: "B-2" });
    const e = oneRosterEnrollment({ sourcedId: "e1", userSourcedId: "u1", classSourcedId: "c1", role: "student", primary: "false" })!;
    expect(e.data).toMatchObject({ userId: "u1", classId: "c1", role: "student", primary: false });
    expect(oneRosterEnrollment({ sourcedId: "e2" })).toBeNull();
  });

  it("reads Clever students, contacts with relationships, and sections as enrollments", () => {
    const s = cleverUser({ id: "cs1", name: { first: "Karim", last: "Ali" }, roles: { student: { student_number: "CV-1", grade: "Kindergarten", school: "sch" } } })!;
    expect(s.data).toMatchObject({ role: "student", identifier: "CV-1", grades: ["KG"], orgIds: ["sch"] });
    const p = cleverUser({ id: "cp1", email: "Dana@family.test", name: { first: "Dana", last: "Ali" }, roles: { contact: { student_relationships: [{ student: "cs1", relationship: "Mother" }] } } })!;
    expect(p.data).toMatchObject({ role: "relative", agentIds: ["cs1"], relationships: { cs1: "Mother" } });
    expect(relationshipLabel("Mother", "relative")).toEqual({ en: "Mother", ar: "الأم" });
    const sec = cleverSection({ id: "sec", name: "Math 3", teacher: "t1", teachers: ["t1", "t2"], students: ["s1", "s2"], grade: "3" });
    expect(sec.map((x) => x.kind)).toEqual(["class", "enrollment", "enrollment", "enrollment", "enrollment"]);
    expect(sec.filter((x) => (x.data as { role?: string }).role === "teacher" && (x.data as { primary?: boolean }).primary).length).toBe(1);
  });

  it("hashes the content, not the key order", () => {
    const a = oneRosterUser({ sourcedId: "u1", givenName: "A", familyName: "B" })!;
    const b = oneRosterUser({ familyName: "B", givenName: "A", sourcedId: "u1" })!;
    expect(a.hash).toBe(b.hash);
    expect(recordHash({ ...a.data, givenName: "C" } as never)).not.toBe(a.hash);
  });
});

describe("OAuth 1.0a signing", () => {
  it("matches an independent HMAC-SHA256 implementation", () => {
    const url = `https://example.oneroster.com/ims/oneroster/v1p1/users?limit=1000&offset=0&filter=${encodeURIComponent("dateLastModified>'2026-10-01T00:00:00.000Z'")}`;
    const header = oauth1Header("GET", url, "key123", "s3cr3t!", { nonce: "abc", timestamp: 1700000000 });
    const sig = /oauth_signature="([^"]+)"/.exec(header)?.[1];
    expect(decodeURIComponent(sig!)).toBe("tqt/+3+Ukc+RtpYnKaihHiCd2YA6FMHyracZJOr5y1U=");
    expect(header).toContain('oauth_signature_method="HMAC-SHA256"');
    expect(pct("a b!*'()")).toBe("a%20b%21%2A%27%28%29");
  });
});

describe("OneRoster CSV zips", () => {
  it("reads OneRoster 1.2 users with roles.csv and a delta manifest", () => {
    const zip = createZip([
      { name: "manifest.csv", data: "propertyName,value\nfile.users,delta" },
      { name: "users.csv", data: "sourcedId,status,givenName,familyName,email,identifier,grades,agentSourcedIds\nu1,active,Adam,Nasser,adam@school.test,HIS-1,09,p1" },
      { name: "roles.csv", data: "sourcedId,status,userSourcedId,roleType,role,orgSourcedId\nr1,active,u1,primary,student,o1" },
    ]);
    const parsed = parseOneRosterZip(zip);
    expect(parsed.mode).toBe("DELTA");
    expect(parsed.records[0].data).toMatchObject({ role: "student", orgIds: ["o1"], agentIds: ["p1"], grades: ["09"] });
  });

  it("refuses files that are not OneRoster zips", () => {
    expect(() => readZipGuarded(Buffer.from("not a zip at all, just text"))).toThrow(CsvRosterError);
    expect(() => parseOneRosterZip(createZip([{ name: "orgs.csv", data: "sourcedId,name\no1,School" }]))).toThrow(/NO_USERS/);
    expect(() => parseOneRosterZip(createZip([{ name: "users.csv", data: "name,email\nA,a@b.test" }]))).toThrow(/BAD_HEADER/);
  });
});
