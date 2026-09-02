/**
 * Quantalyze's first test configuration — introduced alongside the MCP
 * vertical slice (see lib/mcp/) rather than as a separate initiative.
 * Scope deliberately stays narrow to what's actually tested today: pure
 * Node logic under lib/ and app/api/, no DOM/React component testing yet
 * (see discussions/13_TESTING.md for the full, honest account of what test
 * coverage does and doesn't exist).
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "finance-agent/**", "disclosure-analysis-pipeline/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
