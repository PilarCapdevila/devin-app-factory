import type { KycCase, Prisma } from "@/generated/prisma/client";
import { createApprovalRequest } from "@/platform/approvals";
import { listAuditEvents, writeAuditEvent } from "@/platform/audit";
import type { SessionUser } from "@/platform/auth";
import { prisma, withTransaction, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { KYC_DECISION_ACTION, KYC_ENTITY_TYPE, type CaseStatus, type Recommendation } from "./types";
import { visibleWhere } from "./visibleWhere";

const assignedToSelect = { select: { id: true, name: true, email: true } } as const;

/** Parses the JSON columns so API responses contain real arrays. */
export function serializeCase<T extends KycCase>(kycCase: T) {
  return { ...kycCase, riskFlags: JSON.parse(kycCase.riskFlags) as string[], status: kycCase.status as CaseStatus };
}

export type CaseFilters = {
  status?: CaseStatus;
  minRisk?: number;
  maxRisk?: number;
};

export async function listCases(user: SessionUser, filters: CaseFilters = {}) {
  const where: Prisma.KycCaseWhereInput = {
    ...visibleWhere(user),
    status: filters.status,
    riskScore: filters.minRisk !== undefined || filters.maxRisk !== undefined ? { gte: filters.minRisk, lte: filters.maxRisk } : undefined,
  };
  const cases = await prisma.kycCase.findMany({
    where,
    orderBy: [{ riskScore: "desc" }, { createdAt: "asc" }],
    include: { assignedTo: assignedToSelect },
  });
  return cases.map(serializeCase);
}

/** Loads one visible case or throws NotFoundError (404, never 403, so IDs cannot be probed). */
export async function findVisibleCase(tx: Tx, user: SessionUser, id: string): Promise<KycCase> {
  const kycCase = await tx.kycCase.findFirst({ where: { id, ...visibleWhere(user) } });
  if (!kycCase) throw new NotFoundError();
  return kycCase;
}

export async function getCase(user: SessionUser, id: string) {
  const kycCase = await prisma.kycCase.findFirst({
    where: { id, ...visibleWhere(user) },
    include: { assignedTo: assignedToSelect },
  });
  if (!kycCase) throw new NotFoundError();
  const [auditTrail, approvalRequests] = await Promise.all([
    listAuditEvents(prisma, { entityType: KYC_ENTITY_TYPE, entityId: id }),
    prisma.approvalRequest.findMany({
      where: { entityType: KYC_ENTITY_TYPE, entityId: id },
      orderBy: { requestedAt: "desc" },
      include: { requestedBy: assignedToSelect, decidedBy: assignedToSelect },
    }),
  ]);
  return {
    ...serializeCase(kycCase),
    auditTrail,
    approvalRequests: approvalRequests.map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown })),
  };
}

export async function listAnalysts() {
  return prisma.user.findMany({ where: { role: "analyst" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
}

async function updateStatus(
  tx: Tx,
  actor: SessionUser,
  before: KycCase,
  data: Prisma.KycCaseUncheckedUpdateInput,
  action: string,
  reason?: string,
) {
  const after = await tx.kycCase.update({ where: { id: before.id }, data });
  await writeAuditEvent(tx, {
    actorId: actor.id,
    actorRole: actor.role,
    action,
    entityType: KYC_ENTITY_TYPE,
    entityId: before.id,
    before,
    after,
    reason,
  });
  return serializeCase(after);
}

export async function assignCase(user: SessionUser, id: string, analystId: string) {
  return withTransaction(async (tx) => {
    const kycCase = await findVisibleCase(tx, user, id);
    if (kycCase.status !== "NEW" && kycCase.status !== "IN_REVIEW") {
      throw new ValidationError("Only NEW or IN_REVIEW cases can be assigned");
    }
    const analyst = await tx.user.findUnique({ where: { id: analystId } });
    if (!analyst || analyst.role !== "analyst") throw new ValidationError("analystId must reference an analyst");
    return updateStatus(tx, user, kycCase, { assignedToId: analyst.id }, "kyc.case.assigned");
  });
}

export async function startReview(user: SessionUser, id: string) {
  return withTransaction(async (tx) => {
    const kycCase = await findVisibleCase(tx, user, id);
    if (kycCase.status !== "NEW") throw new ValidationError("Only NEW cases can be started");
    return updateStatus(tx, user, kycCase, { status: "IN_REVIEW" }, "kyc.case.review_started");
  });
}

export async function recommend(user: SessionUser, id: string, recommendation: Recommendation, note: string) {
  return withTransaction(async (tx) => {
    const kycCase = await findVisibleCase(tx, user, id);
    if (kycCase.status !== "IN_REVIEW") throw new ValidationError("Only IN_REVIEW cases can receive a recommendation");
    await createApprovalRequest(tx, {
      entityType: KYC_ENTITY_TYPE,
      entityId: kycCase.id,
      action: KYC_DECISION_ACTION,
      payload: { recommendation },
      requestedById: user.id,
      requestNote: note,
    });
    return updateStatus(tx, user, kycCase, { status: "PENDING_APPROVAL" }, "kyc.case.recommended", note);
  });
}
