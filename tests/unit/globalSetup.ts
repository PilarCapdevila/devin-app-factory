import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

export const UNIT_DB_FILE = "unit-test.db";
export const UNIT_DB_URL = `file:./${UNIT_DB_FILE}`;

/** Fresh, migrated, seeded SQLite database for the unit tests (separate from dev.db/test.db). */
export default function setup() {
  const root = path.resolve(__dirname, "../..");
  for (const suffix of ["", "-journal"]) {
    const file = path.join(root, `${UNIT_DB_FILE}${suffix}`);
    if (existsSync(file)) unlinkSync(file);
  }
  const env = { ...process.env, DATABASE_URL: UNIT_DB_URL, SESSION_SECRET: process.env.SESSION_SECRET ?? "unit-test-session-secret-0123456789abcdef" };
  execSync("npx prisma migrate deploy", { cwd: root, env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "pipe" });
}
