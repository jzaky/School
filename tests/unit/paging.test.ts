// Server-side paging: real totals, clamped pages, links that keep the filters.
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, pageHref, pageWindow, searchTerm } from "@/server/common/paging";
import { gradeParam, studentSearchWhere } from "@/server/students/grade-options";

describe("pageWindow", () => {
  it("shows 1 to 50 of 1,554 on the first page", () => {
    const w = pageWindow(undefined, 1554);
    expect(w).toMatchObject({ page: 1, pages: 32, skip: 0, take: PAGE_SIZE, from: 1, to: 50, total: 1554 });
  });

  it("reads the last partial page", () => {
    expect(pageWindow("32", 1554)).toMatchObject({ page: 32, skip: 1550, from: 1551, to: 1554 });
  });

  it("clamps pages that do not exist and ignores junk", () => {
    expect(pageWindow("99", 1554).page).toBe(32);
    expect(pageWindow("0", 1554).page).toBe(1);
    expect(pageWindow("-3", 1554).page).toBe(1);
    expect(pageWindow("2.5", 1554).page).toBe(1);
    expect(pageWindow("abc", 1554).page).toBe(1);
    expect(pageWindow(["3", "4"], 1554).page).toBe(3);
  });

  it("handles an empty list", () => {
    expect(pageWindow("4", 0)).toMatchObject({ page: 1, pages: 1, skip: 0, from: 0, to: 0, total: 0 });
  });

  it("takes a page size", () => {
    expect(pageWindow("2", 45, 20)).toMatchObject({ page: 2, pages: 3, skip: 20, from: 21, to: 40 });
  });
});

describe("pageHref", () => {
  it("keeps the filters and drops the page for page 1", () => {
    expect(pageHref("/students", { grade: "-1", q: "ahmed", page: "4" }, 2)).toBe("/students?grade=-1&q=ahmed&page=2");
    expect(pageHref("/students", { grade: "-1", q: undefined }, 1)).toBe("/students?grade=-1");
    expect(pageHref("/students", {}, 1)).toBe("/students");
  });
});

describe("search and grade parameters", () => {
  it("normalizes the search box", () => {
    expect(searchTerm("  Ahmed   Al  Hammadi ")).toBe("Ahmed Al Hammadi");
    expect(searchTerm(undefined)).toBe("");
    expect(searchTerm("x".repeat(200))).toHaveLength(80);
  });

  it("matches every word against names and the student number", () => {
    const w = studentSearchWhere("Ahmed Hammadi") as { AND: Array<{ OR: unknown[] }> };
    expect(w.AND).toHaveLength(2);
    expect(w.AND[0].OR).toHaveLength(6);
    expect(studentSearchWhere("   ")).toEqual({});
  });

  it("accepts KG grades in the URL and nothing else", () => {
    expect(gradeParam("-1")).toBe(-1);
    expect(gradeParam("0")).toBe(0);
    expect(gradeParam("12")).toBe(12);
    expect(gradeParam("13")).toBeNull();
    expect(gradeParam("-2")).toBeNull();
    expect(gradeParam("")).toBeNull();
    expect(gradeParam(undefined)).toBeNull();
    expect(gradeParam("9; drop")).toBeNull();
  });
});
