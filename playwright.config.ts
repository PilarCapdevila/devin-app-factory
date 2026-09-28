import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Security tests (tests/security, reserved for independent tests) run in API mode against a
 * separate, freshly reset and seeded database (test.db) on port 3100.
 *
 * DATABASE_URL is fixed here so that tests importing platform functions or Prisma directly
 * hit test.db too. SESSION_SECRET falls back to a test-only value when no .env is present (CI).
 */
export const TEST_DATABASE_URL = "file:./test.db";
export const TEST_PORT = 3100;
export const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET ??= "test-only-session-secret-not-for-production-0123456789";

export default defineConfig({
  testDir: "tests/security",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: TEST_BASE_URL,
    extraHTTPHeaders: { accept: "application/json" },
  },
  // Reset (drop + migrate) and seed test.db, then start the app. Stop any other `next dev` in this
  // directory first: Next.js allows one dev server per project directory.
  webServer: {
    command: `node scripts/reset-db.mjs && npx next dev -p ${TEST_PORT}`,
    cwd: path.resolve(__dirname),
    url: `${TEST_BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET,
      SEED_USER_PASSWORD: process.env.SEED_USER_PASSWORD ?? "password123",
    },
  },
});
