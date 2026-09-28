import { z } from "zod";
import { listAuditEvents } from "@/platform/audit";
import { prisma } from "@/platform/db";
import { secureHandler } from "@/platform/handler";

const auditInput = z.strictObject({
  actorId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const GET = secureHandler({ permission: "audit.read", input: auditInput }, ({ input }) => listAuditEvents(prisma, input));
