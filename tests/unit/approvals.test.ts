import { beforeAll, describe, expect, it } from "vitest";
import { loadApps } from "@/platform/apps";
import { createApprovalRequest, decideApproval, listPendingApprovalsFor, requiredApprovalsFor } from "@/platform/approvals";
import { prisma, withTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { alice, bob, carol, createCase, dan } from "./helpers";

async function pendingRequest(requesterId: string, recommendation: "approve" | "reject" = "approve") {
  const kycCase = await createCase({ status: "PENDING_APPROVAL", assignedToId: requesterId });
  const request = await withTransaction((tx) =>
    createApprovalRequest(tx, {
      entityType: "kyc.case",
      entityId: kycCase.id,
      action: "kyc.decision",
      payload: { recommendation },
      requestedById: requesterId,
      requestNote: "unit test recommendation",
    }),
  );
  return { kycCase, request };
}

describe("approvals engine", () => {
  beforeAll(() => loadApps());

  it("creates a PENDING request with the requester and audits it", async () => {
    const requester = await alice();
    const { request } = await pendingRequest(requester.id);
    expect(request.status).toBe("PENDING");
    expect(request.requestedById).toBe(requester.id);
    expect(request.decidedById).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "approval.requested", entityId: request.id } })).toBe(1);
  });

  it("rejects an unregistered action", async () => {
    const requester = await alice();
    await expect(
      withTransaction((tx) =>
        createApprovalRequest(tx, { entityType: "x", entityId: "y", action: "nope.action", payload: {}, requestedById: requester.id, requestNote: "n" }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("the requester can never decide their own request (maker-checker)", async () => {
    const requester = await alice();
    const { request } = await pendingRequest(requester.id);
    await expect(decideApproval({ requestId: request.id, deciderId: requester.id, decision: "confirm", note: "self" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
  });

  it("requires the action's decidePermission", async () => {
    const requester = await alice();
    const { request } = await pendingRequest(requester.id);
    const admin = await dan();
    const otherAnalyst = await bob();
    await expect(decideApproval({ requestId: request.id, deciderId: admin.id, decision: "confirm", note: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideApproval({ requestId: request.id, deciderId: otherAnalyst.id, decision: "confirm", note: "peer" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires a decision note and a known decision", async () => {
    const requester = await alice();
    const { request } = await pendingRequest(requester.id);
    const approver = await carol();
    await expect(decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(decideApproval({ requestId: request.id, deciderId: approver.id, decision: "maybe" as "confirm", note: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(decideApproval({ requestId: "missing", deciderId: approver.id, decision: "confirm", note: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("confirm runs the app's onConfirm: one decider by default (requiredApprovals unset), final status set, audited", async () => {
    const requester = await alice();
    const approver = await carol();
    const { kycCase, request } = await pendingRequest(requester.id, "reject");
    expect(await requiredApprovalsFor(request)).toBe(1);
    const decided = await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "agree" });
    expect(decided.status).toBe("CONFIRMED");
    expect(decided.decidedById).toBe(approver.id);
    expect(decided.decidedAt).toBeInstanceOf(Date);
    expect(decided.decisionNote).toBe("agree");
    expect(decided.requiredApprovals).toBe(1);
    expect(decided.confirmations.map((c) => c.approverId)).toEqual([approver.id]);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: kycCase.id } })).status).toBe("REJECTED");
    expect(await prisma.auditEvent.count({ where: { action: "approval.confirmed", entityId: request.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "approval.step_confirmed", entityId: request.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "kyc.case.rejected", entityId: kycCase.id } })).toBe(1);
  });

  it("return runs onReturn and sends the case back to IN_REVIEW", async () => {
    const requester = await alice();
    const approver = await carol();
    const { kycCase, request } = await pendingRequest(requester.id);
    const decided = await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "return", note: "need more evidence" });
    expect(decided.status).toBe("RETURNED");
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: kycCase.id } })).status).toBe("IN_REVIEW");
  });

  it("a decided request cannot be decided again", async () => {
    const requester = await alice();
    const approver = await carol();
    const { request } = await pendingRequest(requester.id);
    await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "ok" });
    await expect(decideApproval({ requestId: request.id, deciderId: approver.id, decision: "return", note: "again" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the inbox only shows requests the caller may decide and never their own", async () => {
    const requester = await alice();
    const { request } = await pendingRequest(requester.id);
    const inCarolsInbox = (await listPendingApprovalsFor(await carol())).find((r) => r.id === request.id);
    expect(inCarolsInbox).toMatchObject({ requiredApprovals: 1, confirmations: [] });
    expect((await listPendingApprovalsFor(requester)).some((r) => r.id === request.id)).toBe(false);
    expect(await listPendingApprovalsFor(await dan())).toEqual([]);
  });
});
