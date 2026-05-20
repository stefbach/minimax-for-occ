import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest configuration for the Next.js web package.
 *
 * - Node environment is enough for our pure-logic unit tests (no DOM/JSX).
 * - `@/*` path alias matches tsconfig.json so test files can `import "@/lib/…"`.
 * - Tests live under `__tests__/` and end in `.test.ts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    globals: false,
    clearMocks: true,
  },
  resolve: {
    alias: {
      "@": root,
    },
  },
});
