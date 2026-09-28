import { defineConfig } from "@playwright/test";
import { APP_PORT, BASE_URL, TEST_DATABASE_URL } from "./helpers/config";

/**
 * Playwright API-testing configuration for the independent security suite (SPEC.md §11).
 *
 * Intended entry point for `npm run test:security`, e.g.
 *   DATABASE_URL=file:./test.db npm run setup && playwright test -c tests/security/playwright.config.ts
 *
 * The suite mutates seed data (assignments, reviews, decisions) and asserts on the shared
 * audit table, so it runs serially in a single worker against a freshly reset `test.db`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
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
        command: process.env.SECURITY_WEB_SERVER_COMMAND ?? `npx next dev --port ${APP_PORT}`,
        url: `${BASE_URL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? TEST_DATABASE_URL, PORT: String(APP_PORT) },
      },
});
