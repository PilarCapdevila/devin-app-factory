import { beforeAll, describe, expect, it } from "vitest";
import { assignDispute, getDispute, listDisputes, recommend, startReview } from "@/apps/disputes/disputes";
import { DISPUTE_ENTITY_TYPE } from "@/apps/disputes/types";
import { visibleWhere } from "@/apps/disputes/visibleWhere";
import { loadApps } from "@/platform/apps";
import { decideApproval } from "@/platform/approvals";
import { prisma } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { revealField } from "@/platform/pii";
import { alice, bob, carol, dan, erin } from "./helpers";

/** Creates an isolated dispute so tests do not depend on the seed's state machine positions. */
async function createDispute(overrides: { status?: string; assignedToId?: string | null; responseDeadline?: Date } = {}) {
  return prisma.dispute.create({
    data: {
      merchantName: "Unit Test Merchant (TEST)",
      amountMinor: 12500,
      currency: "USD",
      reasonCode: "fraud",
      customerName: "Unit Test Customer (TEST)",
      customerEmail: "unit-test-customer@example.test",
      customerAddress: "1 Test Street, Testville (fake)",
      cardLast4: "4242",
      responseDeadline: overrides.responseDeadline ?? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      status: overrides.status ?? "NEW",
      assignedToId: overrides.assignedToId ?? null,
    },
  });
}

describe("disputes record-level access", () => {
  it("visibleWhere scopes analysts to their own disputes and nobody else", async () => {
    const analyst = await alice();
    expect(visibleWhere(analyst)).toEqual({ assignedToId: analyst.id });
    expect(visibleWhere(await carol())).toEqual({});
    expect(visibleWhere(await dan())).toEqual({});
    expect(visibleWhere(await erin())).toEqual({});
  });

  it("listDisputes returns only the analyst's disputes, nearest deadline first", async () => {
    const analyst = await alice();
    const disputes = await listDisputes(analyst);
    expect(disputes.length).toBeGreaterThan(0);
    expect(disputes.every((d) => d.assignedToId === analyst.id)).toBe(true);
    for (let i = 1; i < disputes.length; i++) {
      expect(disputes[i - 1].responseDeadline.getTime()).toBeLessThanOrEqual(disputes[i].responseDeadline.getTime());
    }
  });

  it("filters by status and deadline window", async () => {
    const approver = await carol();
    const byStatus = await listDisputes(approver, { status: "NEW" });
    expect(byStatus.every((d) => d.status === "NEW")).toBe(true);
    const overdue = await listDisputes(approver, { dueWithinDays: 0 });
    expect(overdue.length).toBeGreaterThan(0);
    expect(overdue.every((d) => d.responseDeadline.getTime() <= Date.now())).toBe(true);
  });

  it("getDispute throws NotFoundError (404, not 403) for a dispute assigned to someone else", async () => {
    const other = await bob();
    const dispute = await createDispute({ assignedToId: other.id });
    await expect(getDispute(await alice(), dispute.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startReview(await alice(), dispute.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDispute(await carol(), dispute.id)).id).toBe(dispute.id);
  });
});

describe("disputes workflow", () => {
  beforeAll(() => loadApps());

  it("admin assigns NEW/IN_REVIEW disputes to analysts only", async () => {
    const admin = await dan();
    const analyst = await bob();
    const dispute = await createDispute();
    const assigned = await assignDispute(admin, dispute.id, analyst.id);
    expect(assigned.assignedToId).toBe(analyst.id);
    await expect(assignDispute(admin, dispute.id, admin.id)).rejects.toBeInstanceOf(ValidationError);
    const done = await createDispute({ status: "CONTESTED" });
    await expect(assignDispute(admin, done.id, analyst.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.auditEvent.count({ where: { action: "disputes.dispute.assigned", entityId: dispute.id } })).toBe(1);
  });

  it("NEW → IN_REVIEW → PENDING_APPROVAL with an approval request; final status is never set by the analyst", async () => {
    const analyst = await alice();
    const dispute = await createDispute({ assignedToId: analyst.id });

    await expect(recommend(analyst, dispute.id, "accept", "too early")).rejects.toBeInstanceOf(ValidationError);
    expect((await startReview(analyst, dispute.id)).status).toBe("IN_REVIEW");
    await expect(startReview(analyst, dispute.id)).rejects.toBeInstanceOf(ValidationError);

    const pending = await recommend(analyst, dispute.id, "contest", "strong evidence the charge was legitimate");
    expect(pending.status).toBe("PENDING_APPROVAL");
    await expect(recommend(analyst, dispute.id, "accept", "again")).rejects.toBeInstanceOf(ValidationError);

    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityType: DISPUTE_ENTITY_TYPE, entityId: dispute.id } });
    expect(request.status).toBe("PENDING");
    expect(request.requestedById).toBe(analyst.id);
    expect(JSON.parse(request.payload)).toEqual({ recommendation: "contest" });

    const actions = (await prisma.auditEvent.findMany({ where: { entityId: dispute.id }, orderBy: { timestamp: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["disputes.dispute.review_started", "disputes.dispute.recommended"]);
  });

  async function pendingRequest(requesterId: string, recommendation: "accept" | "contest") {
    const dispute = await createDispute({ status: "IN_REVIEW", assignedToId: requesterId });
    const requester = requesterId === (await alice()).id ? await alice() : await bob();
    await recommend(requester, dispute.id, recommendation, "unit test recommendation");
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityType: DISPUTE_ENTITY_TYPE, entityId: dispute.id } });
    return { dispute, request };
  }

  it("confirm sets ACCEPTED or CONTESTED per the recommendation and audits it", async () => {
    const requester = await alice();
    const approver = await carol();
    const { dispute, request } = await pendingRequest(requester.id, "contest");
    const decided = await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "agree, fight it" });
    expect(decided.status).toBe("CONFIRMED");
    expect(decided.decidedById).toBe(approver.id);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("CONTESTED");
    expect(await prisma.auditEvent.count({ where: { action: "approval.confirmed", entityId: request.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "disputes.dispute.contested", entityId: dispute.id } })).toBe(1);

    const second = await pendingRequest(requester.id, "accept");
    await decideApproval({ requestId: second.request.id, deciderId: approver.id, decision: "confirm", note: "agree, take the loss" });
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: second.dispute.id } })).status).toBe("ACCEPTED");
    expect(await prisma.auditEvent.count({ where: { action: "disputes.dispute.accepted", entityId: second.dispute.id } })).toBe(1);
  });

  it("return sends the dispute back to IN_REVIEW with a disputes.dispute.returned event", async () => {
    const requester = await alice();
    const approver = await carol();
    const { dispute, request } = await pendingRequest(requester.id, "accept");
    const decided = await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "return", note: "need stronger evidence" });
    expect(decided.status).toBe("RETURNED");
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("IN_REVIEW");
    expect(await prisma.auditEvent.count({ where: { action: "disputes.dispute.returned", entityId: dispute.id } })).toBe(1);
  });

  it("maker-checker: the requester cannot decide, others need disputes.dispute.decide, a request decides once", async () => {
    const requester = await alice();
    const approver = await carol();
    const { request } = await pendingRequest(requester.id, "accept");

    await expect(decideApproval({ requestId: request.id, deciderId: requester.id, decision: "confirm", note: "self" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideApproval({ requestId: request.id, deciderId: (await dan()).id, decision: "confirm", note: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideApproval({ requestId: request.id, deciderId: (await bob()).id, decision: "confirm", note: "peer" })).rejects.toBeInstanceOf(ForbiddenError);

    await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "ok" });
    await expect(decideApproval({ requestId: request.id, deciderId: approver.id, decision: "return", note: "again" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("disputes PII reveal", () => {
  it("reveals each PII field and audits it; non-PII fields are rejected", async () => {
    const user = await alice();
    const dispute = await createDispute({ assignedToId: user.id });
    for (const field of ["customerEmail", "customerAddress"] as const) {
      const result = await revealField({ user, entityType: DISPUTE_ENTITY_TYPE, entityId: dispute.id, field, reason: "verifying cardholder contact details" });
      expect(result.field).toBe(field);
      expect(result.value).toBe(String(dispute[field]));
    }
    expect(await prisma.auditEvent.count({ where: { action: "pii.reveal", entityId: dispute.id } })).toBe(2);
    await expect(revealField({ user, entityType: DISPUTE_ENTITY_TYPE, entityId: dispute.id, field: "customerName", reason: "long enough reason" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires pii.reveal, a long enough reason, and record-level access", async () => {
    const owner = await bob();
    const dispute = await createDispute({ assignedToId: owner.id });
    await expect(
      revealField({ user: await dan(), entityType: DISPUTE_ENTITY_TYPE, entityId: dispute.id, field: "customerEmail", reason: "legitimate investigation" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      revealField({ user: owner, entityType: DISPUTE_ENTITY_TYPE, entityId: dispute.id, field: "customerEmail", reason: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      revealField({ user: await alice(), entityType: DISPUTE_ENTITY_TYPE, entityId: dispute.id, field: "customerEmail", reason: "legitimate investigation" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.auditEvent.count({ where: { action: "pii.reveal", entityId: dispute.id } })).toBe(0);
  });
});
