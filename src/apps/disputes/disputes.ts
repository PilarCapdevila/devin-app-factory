import type { Dispute, Prisma } from "@/generated/prisma/client";
import { createApprovalRequest } from "@/platform/approvals";
import { listAuditEvents, writeAuditEvent } from "@/platform/audit";
import type { SessionUser } from "@/platform/auth";
import { prisma, withTransaction, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { DISPUTE_DECISION_ACTION, DISPUTE_ENTITY_TYPE, type DisputeRecommendation, type DisputeStatus } from "./types";
import { visibleWhere } from "./visibleWhere";

const assignedToSelect = { select: { id: true, name: true, email: true } } as const;

export function serializeDispute<T extends Dispute>(dispute: T) {
  return { ...dispute, status: dispute.status as DisputeStatus };
}

export type DisputeFilters = {
  status?: DisputeStatus;
  /** Only disputes whose respond-by deadline is within this many days (0 = overdue). */
  dueWithinDays?: number;
};

/** Disputes visible to the user, nearest respond-by deadline first. */
export async function listDisputes(user: SessionUser, filters: DisputeFilters = {}) {
  const where: Prisma.DisputeWhereInput = {
    ...visibleWhere(user),
    status: filters.status,
    responseDeadline: filters.dueWithinDays !== undefined ? { lte: new Date(Date.now() + filters.dueWithinDays * 24 * 60 * 60 * 1000) } : undefined,
  };
  const disputes = await prisma.dispute.findMany({
    where,
    orderBy: [{ responseDeadline: "asc" }, { createdAt: "asc" }],
    include: { assignedTo: assignedToSelect },
  });
  return disputes.map(serializeDispute);
}

/** Loads one visible dispute or throws NotFoundError (404, never 403, so IDs cannot be probed). */
export async function findVisibleDispute(tx: Tx, user: SessionUser, id: string): Promise<Dispute> {
  const dispute = await tx.dispute.findFirst({ where: { id, ...visibleWhere(user) } });
  if (!dispute) throw new NotFoundError();
  return dispute;
}

export async function getDispute(user: SessionUser, id: string) {
  const dispute = await prisma.dispute.findFirst({
    where: { id, ...visibleWhere(user) },
    include: { assignedTo: assignedToSelect },
  });
  if (!dispute) throw new NotFoundError();
  const [auditTrail, approvalRequests] = await Promise.all([
    listAuditEvents(prisma, { entityType: DISPUTE_ENTITY_TYPE, entityId: id }),
    prisma.approvalRequest.findMany({
      where: { entityType: DISPUTE_ENTITY_TYPE, entityId: id },
      orderBy: { requestedAt: "desc" },
      include: { requestedBy: assignedToSelect, decidedBy: assignedToSelect },
    }),
  ]);
  return {
    ...serializeDispute(dispute),
    auditTrail,
    approvalRequests: approvalRequests.map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown })),
  };
}

export async function listAnalysts() {
  return prisma.user.findMany({ where: { role: "analyst" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
}

async function updateDispute(
  tx: Tx,
  actor: SessionUser,
  before: Dispute,
  data: Prisma.DisputeUncheckedUpdateInput,
  action: string,
  reason?: string,
) {
  const after = await tx.dispute.update({ where: { id: before.id }, data });
  await writeAuditEvent(tx, {
    actorId: actor.id,
    actorRole: actor.role,
    action,
    entityType: DISPUTE_ENTITY_TYPE,
    entityId: before.id,
    before,
    after,
    reason,
  });
  return serializeDispute(after);
}

export async function assignDispute(user: SessionUser, id: string, analystId: string) {
  return withTransaction(async (tx) => {
    const dispute = await findVisibleDispute(tx, user, id);
    if (dispute.status !== "NEW" && dispute.status !== "IN_REVIEW") {
      throw new ValidationError("Only NEW or IN_REVIEW disputes can be assigned");
    }
    const analyst = await tx.user.findUnique({ where: { id: analystId } });
    if (!analyst || analyst.role !== "analyst") throw new ValidationError("analystId must reference an analyst");
    return updateDispute(tx, user, dispute, { assignedToId: analyst.id }, "disputes.dispute.assigned");
  });
}

export async function startReview(user: SessionUser, id: string) {
  return withTransaction(async (tx) => {
    const dispute = await findVisibleDispute(tx, user, id);
    if (dispute.status !== "NEW") throw new ValidationError("Only NEW disputes can be started");
    return updateDispute(tx, user, dispute, { status: "IN_REVIEW" }, "disputes.dispute.review_started");
  });
}

/**
 * The maker step: moves the dispute to PENDING_APPROVAL and creates the approval request in one
 * transaction. The final outcome (ACCEPTED/CONTESTED) is set only by the approvals engine.
 */
export async function recommend(user: SessionUser, id: string, recommendation: DisputeRecommendation, note: string) {
  return withTransaction(async (tx) => {
    const dispute = await findVisibleDispute(tx, user, id);
    if (dispute.status !== "IN_REVIEW") throw new ValidationError("Only IN_REVIEW disputes can receive a recommendation");
    await createApprovalRequest(tx, {
      entityType: DISPUTE_ENTITY_TYPE,
      entityId: dispute.id,
      action: DISPUTE_DECISION_ACTION,
      payload: { recommendation },
      requestedById: user.id,
      requestNote: note,
    });
    return updateDispute(tx, user, dispute, { status: "PENDING_APPROVAL" }, "disputes.dispute.recommended", note);
  });
}
