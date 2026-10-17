// Shared lint configuration for the TypeScript packages and the Node services.
// apps/web keeps its own Next.js configuration (apps/web/eslint.config.mjs).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/generated/**", "apps/web/**", "docs/**", "deploy/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: { parserOptions: { ecmaVersion: 2023, sourceType: "module" } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "eqeqeq": ["error", "always"],
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    // Scripts, seeds and tests print to the console on purpose.
    files: ["**/scripts/**", "**/seed/**", "**/tests/**", "**/examples/**", "packages/core/src/seed/**", "**/*.test.ts"],
    rules: { "no-console": "off" },
  },
);
