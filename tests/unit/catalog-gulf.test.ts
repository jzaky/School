import { describe, expect, it } from "vitest";
import { GLOBAL_UNIVERSITIES } from "../../prisma/seed/catalog/universities";
import { buildPrograms } from "../../prisma/seed/catalog/programs";

describe("Gulf catalog additions", () => {
  const saudi = GLOBAL_UNIVERSITIES.filter((u) => u.countryCode === "SA");
  const programs = buildPrograms();

  it("adds Saudi universities with a direct route and bilingual names", () => {
    expect(saudi.length).toBeGreaterThanOrEqual(12);
    for (const u of saudi) {
      expect(u.system).toBe("SA");
      expect(u.applyVia).toBe("DIRECT");
      expect(u.name.ar).toMatch(/[؀-ۿ]/);
      expect(u.city.ar).toMatch(/[؀-ۿ]/);
      expect(u.admissionsUrl.startsWith("https://")).toBe(true);
    }
  });

  it("keeps university keys unique", () => {
    const keys = GLOBAL_UNIVERSITIES.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("builds programme keys from the university key and template, without example fees in Saudi Arabia", () => {
    const kfupm = programs.filter((p) => p.uni === "kfupm").map((p) => p.key);
    expect(kfupm).toContain("kfupm-chemeng");
    expect(programs.some((p) => p.key === "king-saud-university-med")).toBe(true);
    for (const p of programs.filter((x) => saudi.some((u) => u.key === x.uni))) {
      expect(p.tuitionPerYear).toBeNull();
      expect(p.rows.length).toBeGreaterThan(0);
    }
  });
});
