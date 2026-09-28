import type { Dispute, Prisma } from "@/generated/prisma/client";
import { createApprovalRequest } from "@/platform/approvals";
import { listAuditEvents, writeAuditEvent } from "@/platform/audit";
import type { SessionUser } from "@/platform/auth";
import { prisma, withTransaction, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import {
  DISPUTES_DECISION_ACTION,
  DISPUTES_ENTITY_TYPE,
  DUE_SOON_HOURS,
  type DisputeStatus,
  type DueState,
  type Proposal,
} from "./types";
import { visibleWhere } from "./visibleWhere";

const assignedToSelect = { select: { id: true, name: true, email: true } } as const;
const FINAL_STATUSES: readonly DisputeStatus[] = ["ACCEPTED", "CHALLENGED"];

/** Derived at read time, never stored: how close an open dispute is to its response deadline. */
export function dueStateOf(dispute: Pick<Dispute, "status" | "respondBy">, now: Date = new Date()): DueState {
  if (FINAL_STATUSES.includes(dispute.status as DisputeStatus)) return "closed";
  const remainingMs = dispute.respondBy.getTime() - now.getTime();
  if (remainingMs < 0) return "overdue";
  if (remainingMs <= DUE_SOON_HOURS * 60 * 60 * 1000) return "due_soon";
  return "on_track";
}

export function serializeDispute<T extends Dispute>(dispute: T, now: Date = new Date()) {
  return {
    ...dispute,
    status: dispute.status as DisputeStatus,
    proposal: (dispute.proposal ?? null) as Proposal | null,
    dueState: dueStateOf(dispute, now),
  };
}

export type DisputeFilters = {
  status?: DisputeStatus;
  due?: Exclude<DueState, "closed">;
};

/** Queue sorted by deadline (soonest first); `due` filters on the derived due state. */
export async function listDisputes(user: SessionUser, filters: DisputeFilters = {}, now: Date = new Date()) {
  const where: Prisma.DisputeWhereInput = { ...visibleWhere(user), status: filters.status };
  const disputes = await prisma.dispute.findMany({
    where,
    orderBy: [{ respondBy: "asc" }, { createdAt: "asc" }],
    include: { assignedTo: assignedToSelect },
  });
  const serialized = disputes.map((d) => serializeDispute(d, now));
  return filters.due ? serialized.filter((d) => d.dueState === filters.due) : serialized;
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
    listAuditEvents(prisma, { entityType: DISPUTES_ENTITY_TYPE, entityId: id }),
    prisma.approvalRequest.findMany({
      where: { entityType: DISPUTES_ENTITY_TYPE, entityId: id },
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
    entityType: DISPUTES_ENTITY_TYPE,
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

export type ProposeInput = {
  proposal: Proposal;
  note: string;
  evidenceSummary?: string;
};

/**
 * Maker step: records the analyst's proposal, moves the dispute to PENDING_APPROVAL and creates
 * the approval request in one transaction. Fighting a chargeback requires an evidence summary.
 */
export async function propose(user: SessionUser, id: string, input: ProposeInput) {
  const evidenceSummary = input.evidenceSummary?.trim() || null;
  if (input.proposal === "fight" && !evidenceSummary) {
    throw new ValidationError("An evidence summary is required to fight a dispute");
  }
  return withTransaction(async (tx) => {
    const dispute = await findVisibleDispute(tx, user, id);
    if (dispute.status !== "IN_REVIEW") throw new ValidationError("Only IN_REVIEW disputes can receive a proposal");
    await createApprovalRequest(tx, {
      entityType: DISPUTES_ENTITY_TYPE,
      entityId: dispute.id,
      action: DISPUTES_DECISION_ACTION,
      payload: { proposal: input.proposal, evidenceSummary },
      requestedById: user.id,
      requestNote: input.note,
    });
    return updateDispute(
      tx,
      user,
      dispute,
      { status: "PENDING_APPROVAL", proposal: input.proposal, evidenceSummary },
      "disputes.dispute.proposed",
      input.note,
    );
  });
}
