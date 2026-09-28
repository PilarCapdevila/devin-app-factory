import type { ApprovalRequest } from "@/generated/prisma/client";
import { registerApprovalAction } from "@/platform/approvals";
import { writeAuditEvent } from "@/platform/audit";
import type { SessionUser } from "@/platform/auth";
import type { Tx } from "@/platform/db";
import { ValidationError } from "@/platform/errors";
import { registerPiiEntity } from "@/platform/pii";
import { DISPUTES_DECISION_ACTION, DISPUTES_ENTITY_TYPE, PROPOSALS, type DisputeStatus, type Proposal } from "./types";
import { visibleWhere } from "./visibleWhere";

async function setFinalStatus(tx: Tx, request: ApprovalRequest, decider: SessionUser, status: DisputeStatus, action: string) {
  const before = await tx.dispute.findUnique({ where: { id: request.entityId } });
  if (!before) throw new ValidationError("Dispute no longer exists");
  if (before.status !== "PENDING_APPROVAL") throw new ValidationError("Dispute is not pending approval");
  const after = await tx.dispute.update({ where: { id: before.id }, data: { status } });
  await writeAuditEvent(tx, {
    actorId: decider.id,
    actorRole: decider.role,
    action,
    entityType: DISPUTES_ENTITY_TYPE,
    entityId: before.id,
    before,
    after,
    reason: request.decisionNote,
  });
}

registerApprovalAction(DISPUTES_DECISION_ACTION, {
  decidePermission: "disputes.dispute.decide",
  async onConfirm(tx, request, decider) {
    const { proposal } = JSON.parse(request.payload) as { proposal: Proposal };
    if (!PROPOSALS.includes(proposal)) throw new ValidationError("Approval request has an unknown proposal");
    const status: DisputeStatus = proposal === "accept" ? "ACCEPTED" : "CHALLENGED";
    await setFinalStatus(tx, request, decider, status, status === "ACCEPTED" ? "disputes.dispute.accepted" : "disputes.dispute.challenged");
  },
  async onReturn(tx, request, decider) {
    await setFinalStatus(tx, request, decider, "IN_REVIEW", "disputes.dispute.returned");
  },
});

registerPiiEntity(DISPUTES_ENTITY_TYPE, {
  find: (tx, user, id) => tx.dispute.findFirst({ where: { id, ...visibleWhere(user) } }),
});
