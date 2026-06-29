import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          // Containers are slow to boot; give each test room.
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/core/**", "src/advisor/**", "src/diagnostics/**"],
      // Branch target is lower because rules carry many defensive `?? fallback`
      // branches for optional plan fields that don't change correctness.
      thresholds: { lines: 85, functions: 85, branches: 70, statements: 85 },
    },
  },
});
