import type { Prisma, Refund } from "@/generated/prisma/client";
import { createApprovalRequest, requiredApprovalsFor } from "@/platform/approvals";
import { listAuditEvents, writeAuditEvent } from "@/platform/audit";
import type { SessionUser } from "@/platform/auth";
import { prisma, withTransaction, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { REFUND_ENTITY_TYPE, REFUND_ISSUE_ACTION, type RefundIssuePayload, type RefundStatus } from "./types";
import { visibleWhere } from "./visibleWhere";

const userSelect = { select: { id: true, name: true, email: true } } as const;

export function serializeRefund<T extends Refund>(refund: T) {
  return { ...refund, status: refund.status as RefundStatus };
}

export type RefundFilters = {
  status?: RefundStatus;
  minAmountCents?: number;
  maxAmountCents?: number;
};

export type RefundRequestInput = {
  paymentId: string;
  customerName: string;
  customerEmail: string;
  cardLast4: string;
  amountCents: number;
  currency: string;
  reason: string;
};

export async function listRefunds(user: SessionUser, filters: RefundFilters = {}) {
  const hasAmountFilter = filters.minAmountCents !== undefined || filters.maxAmountCents !== undefined;
  const where: Prisma.RefundWhereInput = {
    ...visibleWhere(user),
    status: filters.status,
    amountCents: hasAmountFilter ? { gte: filters.minAmountCents, lte: filters.maxAmountCents } : undefined,
  };
  const refunds = await prisma.refund.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: { requestedBy: userSelect },
  });
  return refunds.map(serializeRefund);
}

/** Loads one visible refund or throws NotFoundError (404, never 403, so IDs cannot be probed). */
export async function findVisibleRefund(tx: Tx, user: SessionUser, id: string): Promise<Refund> {
  const refund = await tx.refund.findFirst({ where: { id, ...visibleWhere(user) } });
  if (!refund) throw new NotFoundError();
  return refund;
}

export async function getRefund(user: SessionUser, id: string) {
  const refund = await prisma.refund.findFirst({
    where: { id, ...visibleWhere(user) },
    include: { requestedBy: userSelect },
  });
  if (!refund) throw new NotFoundError();
  const [auditTrail, approvalRequests] = await Promise.all([
    listAuditEvents(prisma, { entityType: REFUND_ENTITY_TYPE, entityId: id }),
    prisma.approvalRequest.findMany({
      where: { entityType: REFUND_ENTITY_TYPE, entityId: id },
      orderBy: { requestedAt: "desc" },
      include: {
        requestedBy: userSelect,
        decidedBy: userSelect,
        confirmations: { orderBy: { confirmedAt: "asc" }, include: { approver: userSelect } },
      },
    }),
  ]);
  return {
    ...serializeRefund(refund),
    auditTrail,
    approvalRequests: await Promise.all(
      approvalRequests.map(async (r) => ({
        ...r,
        payload: JSON.parse(r.payload) as unknown,
        // Decided requests report the approvals actually recorded; the current policy only governs pending ones.
        requiredApprovals: r.status === "PENDING" ? await requiredApprovalsFor(r) : Math.max(1, r.confirmations.length),
      })),
    ),
  };
}

/** Start of the current UTC day; "issued today" on the dashboard uses UTC on purpose. */
export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function summarizeRefunds(user: SessionUser, now = new Date()) {
  const scope = visibleWhere(user);
  const [pending, issuedToday] = await Promise.all([
    prisma.refund.aggregate({ where: { ...scope, status: "PENDING_APPROVAL" }, _count: true, _sum: { amountCents: true } }),
    prisma.refund.aggregate({ where: { ...scope, status: "ISSUED", issuedAt: { gte: startOfUtcDay(now) } }, _count: true, _sum: { amountCents: true } }),
  ]);
  return {
    pending: { count: pending._count, totalCents: pending._sum.amountCents ?? 0 },
    issuedToday: { count: issuedToday._count, totalCents: issuedToday._sum.amountCents ?? 0 },
  };
}

/**
 * Maker step: creates the refund in PENDING_APPROVAL together with its approval request and
 * audit event in one transaction. Only the approval action moves it to ISSUED or RETURNED.
 */
export async function requestRefund(user: SessionUser, input: RefundRequestInput) {
  return withTransaction(async (tx) => {
    const open = await tx.refund.findFirst({ where: { ...visibleWhere(user), paymentId: input.paymentId, status: "PENDING_APPROVAL" } });
    if (open) throw new ValidationError("A refund request for this payment is already pending approval");

    const refund = await tx.refund.create({ data: { ...input, status: "PENDING_APPROVAL", requestedById: user.id } });
    const payload: RefundIssuePayload = { paymentId: refund.paymentId, amountCents: refund.amountCents, currency: refund.currency };
    await createApprovalRequest(tx, {
      entityType: REFUND_ENTITY_TYPE,
      entityId: refund.id,
      action: REFUND_ISSUE_ACTION,
      payload,
      requestedById: user.id,
      requestNote: input.reason,
    });
    await writeAuditEvent(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "refunds.refund.requested",
      entityType: REFUND_ENTITY_TYPE,
      entityId: refund.id,
      after: refund,
      reason: input.reason,
    });
    return serializeRefund(refund);
  });
}
