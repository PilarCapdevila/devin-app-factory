import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/platform/auth";

/**
 * Record-level access for disputes. Every dispute query spreads this into its `where`, so an
 * analyst only ever sees disputes assigned to them; other roles see all disputes.
 */
export function visibleWhere(user: SessionUser): Prisma.DisputeWhereInput {
  if (user.role === "analyst") return { assignedToId: user.id };
  return {};
}
