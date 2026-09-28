import type { ApprovalRequest, Refund } from "@/generated/prisma/client";
import { getPaymentsConnector } from "@/connectors/payments";
import { registerApprovalAction } from "@/platform/approvals";
import { writeAuditEvent } from "@/platform/audit";
import type { SessionUser } from "@/platform/auth";
import type { Tx } from "@/platform/db";
import { ValidationError } from "@/platform/errors";
import { registerPiiEntity } from "@/platform/pii";
import { REFUND_ENTITY_TYPE, REFUND_ISSUE_ACTION } from "./types";
import { visibleWhere } from "./visibleWhere";

async function pendingRefund(tx: Tx, request: ApprovalRequest): Promise<Refund> {
  const refund = await tx.refund.findUnique({ where: { id: request.entityId } });
  if (!refund) throw new ValidationError("Refund no longer exists");
  if (refund.status !== "PENDING_APPROVAL") throw new ValidationError("Refund is not pending approval");
  return refund;
}

async function audit(tx: Tx, decider: SessionUser, action: string, before: Refund, after: unknown, request: ApprovalRequest) {
  await writeAuditEvent(tx, {
    actorId: decider.id,
    actorRole: decider.role,
    action,
    entityType: REFUND_ENTITY_TYPE,
    entityId: before.id,
    before,
    after,
    reason: request.decisionNote,
  });
}

registerApprovalAction(REFUND_ISSUE_ACTION, {
  decidePermission: "refunds.refund.decide",
  /** The only code path that issues money: connector call and ISSUED status share the transaction. */
  async onConfirm(tx, request, decider) {
    const before = await pendingRefund(tx, request);
    const result = await getPaymentsConnector(tx).issueRefund({
      paymentId: before.paymentId,
      amountCents: before.amountCents,
      idempotencyKey: request.id,
    });
    const after = await tx.refund.update({ where: { id: before.id }, data: { status: "ISSUED", issuedAt: new Date() } });
    await audit(tx, decider, "refunds.refund.issued", before, { ...after, providerRefundId: result.providerRefundId }, request);
  },
  async onReturn(tx, request, decider) {
    const before = await pendingRefund(tx, request);
    const after = await tx.refund.update({ where: { id: before.id }, data: { status: "RETURNED" } });
    await audit(tx, decider, "refunds.refund.returned", before, after, request);
  },
});

registerPiiEntity(REFUND_ENTITY_TYPE, {
  find: (tx, user, id) => tx.refund.findFirst({ where: { id, ...visibleWhere(user) } }),
});
