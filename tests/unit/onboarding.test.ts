import { describe, expect, it } from "vitest";
import { joinCodeFrom, JOIN_CODE_ALPHABET, parseSignup, passwordIssues, passwordScore, regulatorFor, slugCandidates, slugify } from "@/lib/signup";
import { filterNav, moduleEnabled, moduleForPath, normalizeModuleList, pathEnabled, CORE_MODULES } from "@/lib/modules";
import { markStep, setupProgress, stepState } from "@/lib/onboarding";
import { rebrand, subjectCodeForCourse } from "../../prisma/seed/starter/data";
import { brandCss } from "@/components/onboarding/brand-style";

describe("slug generation", () => {
  it("makes URL-safe lowercase slugs", () => {
    expect(slugify("Al Noor International School")).toBe("al-noor-international-school");
    expect(slugify("  École Française & Co. ")).toBe("ecole-francaise-and-co");
  });
  it("handles Arabic-only, short and reserved names", () => {
    expect(slugify("مدرسة النور")).toBe("school");
    expect(slugify("AB")).toBe("school-ab");
    expect(slugify("Horizon")).toBe("horizon-school");
  });
  it("caps length and offers numbered candidates", () => {
    const long = slugify("The Very Long Name Of A School That Goes On And On Forever");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
    const c = slugCandidates("Al Noor", 4);
    expect(c).toEqual(["al-noor", "al-noor-2", "al-noor-3", "al-noor-4"]);
  });
  it("join codes use only unambiguous characters", () => {
    const code = joinCodeFrom(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 255]));
    expect(code).toHaveLength(8);
    for (const ch of code) expect(JOIN_CODE_ALPHABET).toContain(ch);
    expect(code).not.toMatch(/[01IO]/);
  });
});

describe("sign-up validation", () => {
  const good = { schoolNameEn: "Al Noor School", schoolNameAr: "مدرسة النور", emirate: "Dubai", curricula: ["BRITISH"], adminName: "Noura", email: "Noura@AlNoor.test", password: "Strong-pass-2026", isPrincipal: false, locale: "en" };
  it("accepts a complete form and normalises the email", () => {
    const r = parseSignup(good, { needPassword: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.email).toBe("noura@alnoor.test");
  });
  it("names the first bad field", () => {
    expect(parseSignup({ ...good, curricula: [] }, { needPassword: true })).toMatchObject({ ok: false, field: "curricula" });
    expect(parseSignup({ ...good, emirate: "Doha" }, { needPassword: true })).toMatchObject({ ok: false, field: "emirate" });
    expect(parseSignup({ ...good, email: "nope" }, { needPassword: true })).toMatchObject({ ok: false, field: "email" });
    expect(parseSignup({ ...good, schoolNameAr: "" }, { needPassword: true })).toMatchObject({ ok: false, field: "schoolNameAr" });
  });
  it("enforces password strength only when a password is used", () => {
    expect(parseSignup({ ...good, password: "short1" }, { needPassword: true })).toMatchObject({ ok: false, field: "password" });
    expect(parseSignup({ ...good, password: "" }, { needPassword: false }).ok).toBe(true);
    expect(passwordIssues("password12345")).toContain("common");
    expect(passwordIssues("abcdefghijk")).toContain("digit");
    expect(passwordIssues("noura12345xyz", "noura@x.test")).toContain("email");
    expect(passwordIssues("Pilot-School-2026")).toEqual([]);
    expect(passwordScore("")).toBe(0);
    expect(passwordScore("Pilot-School-2026")).toBe(3);
  });
  it("maps emirates to regulators", () => {
    expect(regulatorFor("Dubai")).toBe("KHDA");
    expect(regulatorFor("Abu Dhabi")).toBe("ADEK");
    expect(regulatorFor("Sharjah")).toBe("SPEA");
    expect(regulatorFor("Fujairah")).toBe("MOE");
  });
});

describe("module gating", () => {
  it("treats an empty list as everything on and keeps core on", () => {
    expect(moduleEnabled({ enabledModules: [] }, "trips")).toBe(true);
    expect(moduleEnabled({ enabledModules: ["requests"] }, "trips")).toBe(false);
    expect(moduleEnabled({ enabledModules: ["trips"] }, "safeguarding")).toBe(true);
  });
  it("switches dependent modules off with their parent", () => {
    expect(moduleEnabled({ enabledModules: normalizeModuleList(["pathways"]) }, "pathways")).toBe(false);
    expect(moduleEnabled({ enabledModules: normalizeModuleList(["pathways", "career"]) }, "pathways")).toBe(true);
  });
  it("never stores an empty list, so all-off stays all-off", () => {
    const list = normalizeModuleList([]);
    expect(list).toEqual([...CORE_MODULES]);
    expect(moduleEnabled({ enabledModules: list }, "grades")).toBe(false);
  });
  it("maps paths to modules by the longest prefix", () => {
    expect(moduleForPath("/career/pathways/search?q=1")).toBe("pathways");
    expect(moduleForPath("/career/assessment")).toBe("career");
    expect(moduleForPath("/admin/cover")).toBe("timetable");
    expect(moduleForPath("/requests/1")).toBeNull();
    expect(moduleForPath("/tripsx")).toBeNull();
    expect(pathEnabled({ enabledModules: normalizeModuleList(["career"]) }, "/career/universities")).toBe(false);
  });
  it("hides nav items and empty sections", () => {
    const org = { enabledModules: normalizeModuleList(["grades"]) };
    const nav = filterNav(org, [
      { key: "a", items: [{ href: "/home" }, { href: "/trips" }, { href: "/grades" }] },
      { key: "b", items: [{ href: "/analytics" }] },
    ]);
    expect(nav).toEqual([{ key: "a", items: [{ href: "/home" }, { href: "/grades" }] }]);
  });
});

describe("setup progress", () => {
  it("records done and skipped steps and finds the next one", () => {
    let steps: string[] = [];
    steps = markStep(steps, "profile", false);
    steps = markStep(steps, "year", true);
    expect(stepState(steps, "profile")).toBe("done");
    expect(stepState(steps, "year")).toBe("skipped");
    expect(setupProgress(steps)).toMatchObject({ done: 1, touched: 2, next: "curricula" });
    steps = markStep(steps, "year", false);
    expect(steps.filter((s) => s.includes("year"))).toEqual(["year"]);
    expect(markStep(steps, "profile", true)).toEqual(steps);
  });
});

describe("starter template helpers", () => {
  it("rebrands the demo school's name in one idempotent pass", () => {
    const names = { nameEn: "Al Noor School", nameAr: "مدرسة النور", shortEn: "Al Noor", shortAr: "النور" };
    const once = rebrand("Open Horizon. Trip organiser, Horizon International School. افتح منصة هورايزن", names);
    expect(once).toBe("Open Al Noor. Trip organiser, Al Noor School. افتح منصة النور");
    expect(rebrand(once, names)).toBe(once);
  });
  it("maps global courses to local subjects", () => {
    expect(subjectCodeForCourse("AP_CALC_AB", "AP Calculus AB")).toBe("MATH");
    expect(subjectCodeForCourse("IGCSE_ARABIC", "IGCSE Arabic")).toBe("ARAB");
    expect(subjectCodeForCourse("US_ENG9", "English 9")).toBe("ENG");
  });
  it("only overrides the theme for custom brand colors", () => {
    expect(brandCss("#0F4C81", "#C8A24A")).toBe("");
    expect(brandCss("#7A1F5C", "#C8A24A")).toContain("--brand:#7A1F5C");
    expect(brandCss("red;}body{", "#C8A24A")).toBe("");
  });
});
