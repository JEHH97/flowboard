import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "playwright-report/**",
      "test-results/**",
      "apps/web/next-env.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
);
