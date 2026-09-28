import type { ApprovalRequest } from "@/generated/prisma/client";
import { registerApprovalAction } from "@/platform/approvals";
import { writeAuditEvent } from "@/platform/audit";
import type { SessionUser } from "@/platform/auth";
import type { Tx } from "@/platform/db";
import { ValidationError } from "@/platform/errors";
import { registerPiiEntity } from "@/platform/pii";
import { KYC_DECISION_ACTION, KYC_ENTITY_TYPE, type CaseStatus, type Recommendation } from "./types";
import { visibleWhere } from "./visibleWhere";

async function setFinalStatus(tx: Tx, request: ApprovalRequest, decider: SessionUser, status: CaseStatus, action: string) {
  const before = await tx.kycCase.findUnique({ where: { id: request.entityId } });
  if (!before) throw new ValidationError("Case no longer exists");
  if (before.status !== "PENDING_APPROVAL") throw new ValidationError("Case is not pending approval");
  const after = await tx.kycCase.update({ where: { id: before.id }, data: { status } });
  await writeAuditEvent(tx, {
    actorId: decider.id,
    actorRole: decider.role,
    action,
    entityType: KYC_ENTITY_TYPE,
    entityId: before.id,
    before,
    after,
    reason: request.decisionNote,
  });
}

registerApprovalAction(KYC_DECISION_ACTION, {
  decidePermission: "kyc.case.decide",
  async onConfirm(tx, request, decider) {
    const { recommendation } = JSON.parse(request.payload) as { recommendation: Recommendation };
    const status: CaseStatus = recommendation === "approve" ? "APPROVED" : "REJECTED";
    await setFinalStatus(tx, request, decider, status, status === "APPROVED" ? "kyc.case.approved" : "kyc.case.rejected");
  },
  async onReturn(tx, request, decider) {
    await setFinalStatus(tx, request, decider, "IN_REVIEW", "kyc.case.returned");
  },
});

registerPiiEntity(KYC_ENTITY_TYPE, {
  find: (tx, user, id) => tx.kycCase.findFirst({ where: { id, ...visibleWhere(user) } }),
});
