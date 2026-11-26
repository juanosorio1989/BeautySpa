import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-worker/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/*.bundled_*.{mjs,cjs}",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
