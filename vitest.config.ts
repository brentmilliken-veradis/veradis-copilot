import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The engine (packages/*) is pure TypeScript and runs in the node environment.
// Alias `@/` -> repo root so tests share the same import paths as the Next app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
});
