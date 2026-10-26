import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Docker build context leaves out tests/ and docs/ (.dockerignore), and next build type-checks src, scripts and
// prisma. Code there must never import from those folders, or the production build fails on Railway.
const ROOTS = ["src", "scripts", "prisma"];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx|mts|mjs)$/.test(name) ? [path] : [];
  });

describe("build context", () => {
  it("nothing the production build compiles imports from tests/ or docs/", () => {
    const bad = ROOTS.flatMap(files).filter((f) => /from\s+["'](?:\.\.\/)+(?:tests|docs)\//.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
