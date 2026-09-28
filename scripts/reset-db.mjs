// Recreates the local SQLite database at DATABASE_URL from scratch: delete file → migrate → seed.
// Only works with `file:` URLs; this prototype never targets a shared database server.
import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
if (!url.startsWith("file:")) {
  console.error(`reset-db only supports local SQLite file: URLs, got ${url.split(":")[0]}:...`);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.resolve(root, url.slice("file:".length));
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  if (existsSync(file + suffix)) unlinkSync(file + suffix);
}

const env = { ...process.env, DATABASE_URL: url };
execSync("npx prisma migrate deploy", { cwd: root, env, stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "inherit" });
