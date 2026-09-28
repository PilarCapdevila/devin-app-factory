import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Port the app is started on by the security test runner (SPEC.md §11). */
export const APP_PORT = 3100;

/** Base URL of the app under test. Overridable for running against a different host. */
export const BASE_URL = process.env.SECURITY_BASE_URL ?? `http://localhost:${APP_PORT}`;

/** Database used by the security suite (SPEC.md §11). */
export const TEST_DATABASE_URL = "file:./test.db";

/**
 * Environment variable names under which the dev-only seed password may be published
 * by `.env.example` (SPEC.md §12 does not fix the variable name).
 */
const SEED_PASSWORD_KEYS = ["SEED_PASSWORD", "SEED_USER_PASSWORD", "DEV_PASSWORD", "DEFAULT_PASSWORD"];

function readDotEnv(): Record<string, string> {
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    values[key] = value;
  }
  return values;
}

/** Password shared by all seeded users (SPEC.md §12: "dev-only password from `.env`"). */
export function seedPassword(): string {
  const dotEnv = readDotEnv();
  for (const key of SEED_PASSWORD_KEYS) {
    const value = process.env[key] ?? dotEnv[key];
    if (value) return value;
  }
  throw new Error(
    `Seed password not found. Set one of ${SEED_PASSWORD_KEYS.join(", ")} in the environment or .env`,
  );
}
