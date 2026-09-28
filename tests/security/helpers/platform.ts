import { register } from "node:module";

/**
 * Loads the platform modules the suite is allowed to touch directly (SPEC.md §11): the named
 * platform functions `decideApproval` / `writeAuditEvent` and the generated Prisma client.
 *
 * Those modules are ESM-only TypeScript (import.meta, extensionless relative imports) that
 * Playwright's transform cannot compile, so src/ is excluded from it (`build.external` in
 * playwright.config.ts) and loaded through the hooks in ./platform-loader.ts instead. The
 * imports are dynamic so that they are resolved only after the hooks are registered.
 */
register("./platform-loader.ts", import.meta.url);

type ApprovalsModule = typeof import("../../../src/platform/approvals");
type AuditModule = typeof import("../../../src/platform/audit");
type PrismaModule = typeof import("../../../src/generated/prisma/client");

export const { decideApproval }: ApprovalsModule = await import("../../../src/platform/approvals");
export const { writeAuditEvent }: AuditModule = await import("../../../src/platform/audit");
export const { PrismaClient }: PrismaModule = await import("../../../src/generated/prisma/client");
export type { Prisma } from "../../../src/generated/prisma/client";
