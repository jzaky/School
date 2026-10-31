import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Unit tests of the console's server actions (tests/actions). The Next.js request plumbing (cookies, headers,
 * redirects, cache revalidation) is replaced by small stubs, so each action runs its real code against a real
 * database with a real session. Browser tests stay in Playwright (tests/e2e).
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${here("./src/")}` },
      { find: "next/headers", replacement: here("./tests/actions/stubs/next-headers.ts") },
      { find: "next/navigation", replacement: here("./tests/actions/stubs/next-navigation.ts") },
      { find: "next/cache", replacement: here("./tests/actions/stubs/next-cache.ts") },
      { find: "server-only", replacement: here("./tests/actions/stubs/empty.ts") },
    ],
  },
  test: {
    include: ["tests/actions/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
