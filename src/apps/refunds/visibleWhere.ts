import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/platform/auth";

/**
 * Record-level access for refunds. Every role that may read refunds sees all of them (the
 * business request says support agents work the whole queue), so the scope is empty for
 * everyone; it is still spread into every query so the app follows the platform pattern and a
 * narrower scope can be introduced without touching the queries.
 */
export function visibleWhere(user: SessionUser): Prisma.RefundWhereInput {
  void user;
  return {};
}
