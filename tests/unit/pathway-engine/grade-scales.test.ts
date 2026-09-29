import { describe, expect, it } from "vitest";
import { compareGrades, gradeOptions, gradeRank, meetsGrade, parseGradeProfile, scaleFor } from "@/server/pathway-engine/grade-scales";

describe("grade scales", () => {
  it("ranks A-level grades with A* above A", () => {
    expect(compareGrades("A_LEVEL", "A*", "A")).toBeGreaterThan(0);
    expect(meetsGrade("A_LEVEL", "B", "A")).toBe(false);
    expect(meetsGrade("A_LEVEL", "a*", "A")).toBe(true);
  });
  it("ranks IB grades with 7 above 6", () => {
    expect(compareGrades("IB_7", "7", "6")).toBe(1);
    expect(meetsGrade("IB_7", "5", "6")).toBe(false);
  });
  it("compares percentages numerically", () => {
    expect(meetsGrade("PERCENT", "91.5", "90")).toBe(true);
    expect(meetsGrade("PERCENT", "89%", "90")).toBe(false);
    expect(gradeRank("PERCENT", "120")).toBeNull();
  });
  it("handles US letter grades and a 4.0 GPA", () => {
    expect(meetsGrade("US_LETTER", "A-", "B+")).toBe(true);
    expect(meetsGrade("US_LETTER", "B", "B+")).toBe(false);
    expect(meetsGrade("GPA_4", "3.85", "3.8")).toBe(true);
  });
  it("handles AP 1 to 5 and GCSE 9 to 1", () => {
    expect(meetsGrade("AP_5", "4", "5")).toBe(false);
    expect(meetsGrade("GCSE_9", "7", "6")).toBe(true);
  });
  it("never converts across scales", () => {
    expect(meetsGrade("A_LEVEL", "7", "A")).toBeNull();
    expect(meetsGrade("IB_7", "A", "6")).toBeNull();
    expect(meetsGrade(null, "A", "A")).toBeNull();
  });
  it("parses grade profiles per scale", () => {
    expect(parseGradeProfile("A_LEVEL", "A*AA")).toEqual(["A*", "A", "A"]);
    expect(parseGradeProfile("IB_7", "766")).toEqual(["7", "6", "6"]);
    expect(parseGradeProfile("A_LEVEL", "XYZ")).toBeNull();
  });
  it("picks the scale for a curriculum and qualification", () => {
    expect(scaleFor("AMERICAN", "AP")).toBe("AP_5");
    expect(scaleFor("AMERICAN", "HONORS")).toBe("US_LETTER");
    expect(scaleFor("BRITISH", "IGCSE")).toBe("IGCSE_LETTER");
    expect(scaleFor("CBSE", "CLASS_12")).toBe("PERCENT");
    expect(gradeOptions("A_LEVEL")[0]).toBe("A*");
  });
});
