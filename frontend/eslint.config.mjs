import { URL } from "node:url"
import js from "@eslint/js"
import nextPlugin from "@next/eslint-plugin-next"
import tseslint from "typescript-eslint"
import globals from "globals"

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "public/service-worker.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: new URL(".", import.meta.url).pathname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        URL: "readonly",
      },
    },
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        URL: "readonly",
        console: "readonly",
      },
    },
  },
)
