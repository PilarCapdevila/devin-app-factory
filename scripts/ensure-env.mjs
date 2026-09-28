// Creates .env from .env.example with a freshly generated SESSION_SECRET if .env does not exist yet.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (existsSync(envPath)) {
  process.exit(0);
}

const example = readFileSync(path.join(root, ".env.example"), "utf8");
const secret = randomBytes(32).toString("hex");
writeFileSync(envPath, example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${secret}"`), { mode: 0o600 });
console.log("Created .env with a generated SESSION_SECRET (edit it to change the seed password or database path).");
