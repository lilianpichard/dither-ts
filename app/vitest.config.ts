import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the tsconfig path alias so tests can import components by it too.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.*", "**/*.spec.*", "**/dist/**", "**/coverage/**"],
      reporter: ["text", "lcov"],
      thresholds: {
        branches: 5,
        functions: 5,
        lines: 10,
        statements: 10,
      },
    },
  },
});
