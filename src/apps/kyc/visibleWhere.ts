import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/platform/auth";

/**
 * Record-level access for KYC cases. Every KYC query spreads this into its `where`, so an
 * analyst only ever sees cases assigned to them; other roles see all cases.
 */
export function visibleWhere(user: SessionUser): Prisma.KycCaseWhereInput {
  if (user.role === "analyst") return { assignedToId: user.id };
  return {};
}
