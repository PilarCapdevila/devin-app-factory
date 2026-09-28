import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/unit/globalSetup.ts"],
    setupFiles: ["tests/unit/setupEnv.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
