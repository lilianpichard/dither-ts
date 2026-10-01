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
        // Set just under what the suites reach today, so a drop fails the build
        // and adding tests lifts the floor. The previous 5/5/10/10 protected
        // nothing: the app could lose two thirds of its coverage and stay green.
        branches: 50,
        functions: 45,
        lines: 50,
        statements: 50,
      },
    },
  },
});
