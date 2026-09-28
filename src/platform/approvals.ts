import type { ApprovalConfirmation, ApprovalRequest } from "@/generated/prisma/client";
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
  /**
   * How many different approvers must confirm before onConfirm runs (default 1). Evaluated per
   * request at decision time, so a rule change applies to requests that are already pending.
   */
  requiredApprovals?(request: ApprovalRequest): number;
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

function countRequired(handlers: ApprovalActionHandlers, request: ApprovalRequest): number {
  const required = handlers.requiredApprovals?.(request) ?? 1;
  if (!Number.isInteger(required) || required < 1) throw new ValidationError("requiredApprovals must be a positive integer");
  return required;
}

/** Number of confirmations this request needs before its outcome is final (1 unless the app says otherwise). */
export async function requiredApprovalsFor(request: ApprovalRequest): Promise<number> {
  return countRequired(await getAction(request.action), request);
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

export type DecidedApproval = ApprovalRequest & { confirmations: ApprovalConfirmation[]; requiredApprovals: number };

/**
 * The only path to a final outcome. In one transaction: checks the request is PENDING, the
 * decider is not the requester and has not confirmed it before, the decider holds the action's
 * decidePermission and a note is present. A confirmation is recorded per approver; while fewer
 * than the action's requiredApprovals have confirmed, the request stays PENDING and only the
 * step is audited. The confirmation that completes them (or any return) updates the request,
 * runs the app's onConfirm/onReturn and writes the decision audit event.
 */
export async function decideApproval({ requestId, deciderId, decision, note }: DecideApprovalInput): Promise<DecidedApproval> {
  if (decision !== "confirm" && decision !== "return") throw new ValidationError("Unknown decision");
  if (typeof note !== "string" || note.trim() === "") throw new ValidationError("A decision note is required");

  return withTransaction(async (tx) => {
    const found = await tx.approvalRequest.findUnique({ where: { id: requestId }, include: { confirmations: { orderBy: { confirmedAt: "asc" } } } });
    if (!found) throw new NotFoundError();
    const { confirmations, ...request } = found;

    const deciderRecord = await tx.user.findUnique({ where: { id: deciderId } });
    if (!deciderRecord || !isRole(deciderRecord.role)) throw new ForbiddenError("Unknown decider");
    const decider: SessionUser = { id: deciderRecord.id, email: deciderRecord.email, name: deciderRecord.name, role: deciderRecord.role };

    const handlers = await getAction(request.action);

    if (request.status !== "PENDING") throw new ValidationError("Request is not pending");
    if (request.requestedById === decider.id) throw new ForbiddenError("Requester cannot decide their own request");
    if (!can(decider, handlers.decidePermission)) throw new ForbiddenError(`Missing permission ${handlers.decidePermission}`);
    if (confirmations.some((c) => c.approverId === decider.id)) throw new ForbiddenError("Approver has already confirmed this request");

    const requiredApprovals = countRequired(handlers, request);

    if (decision === "confirm") {
      const confirmation = await tx.approvalConfirmation.create({ data: { requestId: request.id, approverId: decider.id, note } });
      confirmations.push(confirmation);
      if (confirmations.length < requiredApprovals) {
        await writeAuditEvent(tx, {
          actorId: decider.id,
          actorRole: decider.role,
          action: "approval.step_confirmed",
          entityType: "approval.request",
          entityId: request.id,
          before: { ...request, approvalsGiven: confirmations.length - 1, approvalsRequired: requiredApprovals },
          after: { ...request, approvalsGiven: confirmations.length, approvalsRequired: requiredApprovals },
          reason: note,
        });
        return { ...request, confirmations, requiredApprovals };
      }
    }

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
    return { ...updated, confirmations, requiredApprovals };
  });
}

/**
 * Pending requests across all apps that `user` is allowed to decide: never their own, and not
 * the ones they have already confirmed. Each item carries its approval progress.
 */
export async function listPendingApprovalsFor(user: { id: string; role: Role }) {
  await loadApps();
  const decidable = [...actions.entries()].filter(([, h]) => can(user, h.decidePermission)).map(([action]) => action);
  if (decidable.length === 0) return [];
  const requests = await prisma.approvalRequest.findMany({
    where: { status: "PENDING", action: { in: decidable }, requestedById: { not: user.id }, confirmations: { none: { approverId: user.id } } },
    orderBy: { requestedAt: "asc" },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      confirmations: { orderBy: { confirmedAt: "asc" }, include: { approver: { select: { id: true, name: true, email: true } } } },
    },
  });
  return requests.map((r) => ({
    ...r,
    payload: JSON.parse(r.payload) as unknown,
    requiredApprovals: countRequired(actions.get(r.action)!, r),
  }));
}
