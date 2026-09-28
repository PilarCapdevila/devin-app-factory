import type { ApprovalRequest } from "@/generated/prisma/client";
import { writeAuditEvent } from "./audit";
import { loadApps } from "./apps";
import type { SessionUser } from "./auth";
import { prisma, withTransaction, type Tx } from "./db";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { can, isRole, type Permission, type Role } from "./permissions";

export type ApprovalStatus = "PENDING" | "CONFIRMED" | "RETURNED";
export type Decision = "confirm" | "return";

export type ApprovalActionHandlers = {
  /** Permission a user needs to confirm or return requests of this action. */
  decidePermission: Permission;
  onConfirm(tx: Tx, request: ApprovalRequest, decider: SessionUser): Promise<void>;
  onReturn(tx: Tx, request: ApprovalRequest, decider: SessionUser): Promise<void>;
};

const actions = new Map<string, ApprovalActionHandlers>();

/** Each app registers, per action, what happens when a request is confirmed or returned. */
export function registerApprovalAction(action: string, handlers: ApprovalActionHandlers): void {
  actions.set(action, handlers);
}

async function getAction(action: string): Promise<ApprovalActionHandlers> {
  await loadApps();
  const handlers = actions.get(action);
  if (!handlers) throw new ValidationError(`Unknown approval action ${action}`);
  return handlers;
}

export type CreateApprovalRequestInput = {
  entityType: string;
  entityId: string;
  action: string;
  payload: unknown;
  requestedById: string;
  requestNote: string;
};

/** Creates a PENDING request and audits it, inside the caller's transaction. */
export async function createApprovalRequest(tx: Tx, input: CreateApprovalRequestInput): Promise<ApprovalRequest> {
  await getAction(input.action);
  if (input.requestNote.trim() === "") throw new ValidationError("A note is required");
  const requester = await tx.user.findUnique({ where: { id: input.requestedById } });
  if (!requester || !isRole(requester.role)) throw new ForbiddenError("Unknown requester");

  const request = await tx.approvalRequest.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: JSON.stringify(input.payload ?? null),
      requestedById: input.requestedById,
      requestNote: input.requestNote,
    },
  });
  await writeAuditEvent(tx, {
    actorId: requester.id,
    actorRole: requester.role,
    action: "approval.requested",
    entityType: "approval.request",
    entityId: request.id,
    after: request,
    reason: input.requestNote,
  });
  return request;
}

export type DecideApprovalInput = {
  requestId: string;
  deciderId: string;
  decision: Decision;
  note: string;
};

/**
 * The only path to a final outcome. In one transaction: checks the request is PENDING, the
 * decider is not the requester, the decider holds the action's decidePermission and a note is
 * present; updates the request; runs the app's onConfirm/onReturn; writes the audit event.
 */
export async function decideApproval({ requestId, deciderId, decision, note }: DecideApprovalInput): Promise<ApprovalRequest> {
  if (decision !== "confirm" && decision !== "return") throw new ValidationError("Unknown decision");
  if (typeof note !== "string" || note.trim() === "") throw new ValidationError("A decision note is required");

  return withTransaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundError();

    const deciderRecord = await tx.user.findUnique({ where: { id: deciderId } });
    if (!deciderRecord || !isRole(deciderRecord.role)) throw new ForbiddenError("Unknown decider");
    const decider: SessionUser = { id: deciderRecord.id, email: deciderRecord.email, name: deciderRecord.name, role: deciderRecord.role };

    const handlers = await getAction(request.action);

    if (request.status !== "PENDING") throw new ValidationError("Request is not pending");
    if (request.requestedById === decider.id) throw new ForbiddenError("Requester cannot decide their own request");
    if (!can(decider, handlers.decidePermission)) throw new ForbiddenError(`Missing permission ${handlers.decidePermission}`);

    const status: ApprovalStatus = decision === "confirm" ? "CONFIRMED" : "RETURNED";
    const updated = await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status, decidedById: decider.id, decidedAt: new Date(), decisionNote: note },
    });

    if (decision === "confirm") await handlers.onConfirm(tx, updated, decider);
    else await handlers.onReturn(tx, updated, decider);

    await writeAuditEvent(tx, {
      actorId: decider.id,
      actorRole: decider.role,
      action: decision === "confirm" ? "approval.confirmed" : "approval.returned",
      entityType: "approval.request",
      entityId: updated.id,
      before: request,
      after: updated,
      reason: note,
    });
    return updated;
  });
}

/** Pending requests across all apps that `user` is allowed to decide (never their own). */
export async function listPendingApprovalsFor(user: { id: string; role: Role }) {
  await loadApps();
  const decidable = [...actions.entries()].filter(([, h]) => can(user, h.decidePermission)).map(([action]) => action);
  if (decidable.length === 0) return [];
  const requests = await prisma.approvalRequest.findMany({
    where: { status: "PENDING", action: { in: decidable }, requestedById: { not: user.id } },
    orderBy: { requestedAt: "asc" },
    include: { requestedBy: { select: { id: true, name: true, email: true } } },
  });
  return requests.map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown }));
}
