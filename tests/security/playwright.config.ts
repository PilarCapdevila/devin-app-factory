import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { APP_PORT, BASE_URL, TEST_DATABASE_URL } from "./helpers/config";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Playwright API-testing configuration for the independent security suite (SPEC.md §11).
 *
 * Entry point for `npm run test:security`. The webServer step resets and reseeds `test.db`
 * (`npm run db:reset`) and then starts the app on port 3100.
 *
 * The suite mutates seed data (assignments, reviews, decisions) and asserts on the shared
 * audit table, so it runs serially in a single worker against a freshly reset `test.db`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  // Platform modules under src/ are loaded via helpers/platform-loader.ts, not Playwright's transform.
  build: { external: ["**/src/**"] },
  outputDir: path.join(REPO_ROOT, "test-results/security"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { accept: "application/json" },
  },
  webServer: process.env.SECURITY_BASE_URL
    ? undefined
    : {
        command: process.env.SECURITY_WEB_SERVER_COMMAND ?? `npm run db:reset && npx next dev --port ${APP_PORT}`,
        cwd: REPO_ROOT,
        url: `${BASE_URL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL ?? TEST_DATABASE_URL,
          PORT: String(APP_PORT),
        },
      },
});
