import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/platform/auth";

const currentUser = vi.hoisted(() => ({ value: null as SessionUser | null }));
vi.mock("@/platform/auth", () => ({ getCurrentUser: async () => currentUser.value }));

import { assignDispute, dueStateOf, getDispute, listDisputes, propose, startReview } from "@/apps/disputes/disputes";
import { listDisputesInput, proposeInput, revealInput } from "@/apps/disputes/schemas";
import { DISPUTE_PII_FIELDS, DUE_SOON_HOURS } from "@/apps/disputes/types";
import { visibleWhere } from "@/apps/disputes/visibleWhere";
import { loadApps } from "@/platform/apps";
import { createApprovalRequest, decideApproval, listPendingApprovalsFor } from "@/platform/approvals";
import { prisma, withTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { MASK, PII_FIELD_NAMES, revealField } from "@/platform/pii";
import { GET as listRoute } from "@/app/api/disputes/route";
import { GET as detailRoute } from "@/app/api/disputes/[id]/route";
import { POST as revealRoute } from "@/app/api/disputes/[id]/reveal/route";
import { alice, bob, carol, createDispute, dan, erin, jsonRequest } from "./helpers";

const HOUR = 60 * 60 * 1000;
const EVIDENCE = "Signed delivery confirmation and matching device fingerprint for the order.";

async function pendingFightDispute(requesterId: string) {
  const dispute = await createDispute({ status: "PENDING_APPROVAL", assignedToId: requesterId, proposal: "fight", evidenceSummary: EVIDENCE });
  const request = await withTransaction((tx) =>
    createApprovalRequest(tx, {
      entityType: "disputes.dispute",
      entityId: dispute.id,
      action: "disputes.decision",
      payload: { proposal: "fight", evidenceSummary: EVIDENCE },
      requestedById: requesterId,
      requestNote: "unit test proposal",
    }),
  );
  return { dispute, request };
}

describe("disputes record-level access", () => {
  it("visibleWhere scopes analysts to their own disputes; approver, admin and auditor see all", async () => {
    const analyst = await alice();
    expect(visibleWhere(analyst)).toEqual({ assignedToId: analyst.id });
    expect(visibleWhere(await carol())).toEqual({});
    expect(visibleWhere(await dan())).toEqual({});
    expect(visibleWhere(await erin())).toEqual({});
  });

  it("listDisputes returns only the analyst's disputes, soonest deadline first", async () => {
    const analyst = await alice();
    const disputes = await listDisputes(analyst);
    expect(disputes.length).toBeGreaterThan(0);
    expect(disputes.every((d) => d.assignedToId === analyst.id)).toBe(true);
    for (let i = 1; i < disputes.length; i++) {
      expect(disputes[i - 1].respondBy.getTime()).toBeLessThanOrEqual(disputes[i].respondBy.getTime());
    }
    const all = await listDisputes(await carol());
    expect(all.length).toBeGreaterThan(disputes.length);
  });

  it("filters by status and derived due state", async () => {
    const approver = await carol();
    expect((await listDisputes(approver, { status: "NEW" })).every((d) => d.status === "NEW")).toBe(true);
    const overdue = await listDisputes(approver, { due: "overdue" });
    expect(overdue.length).toBeGreaterThan(0);
    expect(overdue.every((d) => d.dueState === "overdue" && d.respondBy.getTime() < Date.now())).toBe(true);
    const dueSoon = await listDisputes(approver, { due: "due_soon" });
    expect(dueSoon.length).toBeGreaterThan(0);
    expect(dueSoon.every((d) => d.dueState === "due_soon")).toBe(true);
    expect((await listDisputes(approver, { due: "on_track" })).length).toBeGreaterThan(0);
  });

  it("getDispute and every write throw NotFoundError (404, not 403) outside the analyst's scope", async () => {
    const other = await bob();
    const dispute = await createDispute({ assignedToId: other.id });
    const analyst = await alice();
    await expect(getDispute(analyst, dispute.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startReview(analyst, dispute.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(propose(analyst, dispute.id, { proposal: "accept", note: "n" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDispute(await carol(), dispute.id)).id).toBe(dispute.id);
    expect((await getDispute(await erin(), dispute.id)).id).toBe(dispute.id);
  });
});

describe("disputes deadline flags", () => {
  const now = new Date("2026-09-28T12:00:00Z");

  it("derives overdue / due_soon / on_track from the response deadline and closed for final statuses", () => {
    const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
    expect(dueStateOf({ status: "NEW", respondBy: at(-1) }, now)).toBe("overdue");
    expect(dueStateOf({ status: "IN_REVIEW", respondBy: at(1) }, now)).toBe("due_soon");
    expect(dueStateOf({ status: "PENDING_APPROVAL", respondBy: at(DUE_SOON_HOURS) }, now)).toBe("due_soon");
    expect(dueStateOf({ status: "NEW", respondBy: at(DUE_SOON_HOURS + 1) }, now)).toBe("on_track");
    expect(dueStateOf({ status: "ACCEPTED", respondBy: at(-100) }, now)).toBe("closed");
    expect(dueStateOf({ status: "CHALLENGED", respondBy: at(1) }, now)).toBe("closed");
  });

  it("rejects unknown due filters and unknown query keys", () => {
    expect(listDisputesInput.safeParse({ due: "overdue" }).success).toBe(true);
    expect(listDisputesInput.safeParse({ due: "closed" }).success).toBe(false);
    expect(listDisputesInput.safeParse({ due: "overdue", extra: 1 }).success).toBe(false);
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
    await expect(assignDispute(admin, dispute.id, "does-not-exist")).rejects.toBeInstanceOf(ValidationError);
    for (const status of ["PENDING_APPROVAL", "ACCEPTED", "CHALLENGED"]) {
      const locked = await createDispute({ status });
      await expect(assignDispute(admin, locked.id, analyst.id)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await prisma.auditEvent.count({ where: { action: "disputes.dispute.assigned", entityId: dispute.id } })).toBe(1);
  });

  it("NEW → IN_REVIEW → PENDING_APPROVAL with an approval request; the analyst never sets a final status", async () => {
    const analyst = await alice();
    const dispute = await createDispute({ assignedToId: analyst.id });

    await expect(propose(analyst, dispute.id, { proposal: "accept", note: "too early" })).rejects.toBeInstanceOf(ValidationError);
    expect((await startReview(analyst, dispute.id)).status).toBe("IN_REVIEW");
    await expect(startReview(analyst, dispute.id)).rejects.toBeInstanceOf(ValidationError);

    const pending = await propose(analyst, dispute.id, { proposal: "accept", note: "amount below evidence threshold" });
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect(pending.proposal).toBe("accept");
    expect(pending.evidenceSummary).toBeNull();
    await expect(propose(analyst, dispute.id, { proposal: "accept", note: "again" })).rejects.toBeInstanceOf(ValidationError);

    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "disputes.dispute", entityId: dispute.id } });
    expect(request.status).toBe("PENDING");
    expect(request.action).toBe("disputes.decision");
    expect(request.requestedById).toBe(analyst.id);
    expect(JSON.parse(request.payload)).toEqual({ proposal: "accept", evidenceSummary: null });

    const actions = (await prisma.auditEvent.findMany({ where: { entityId: dispute.id }, orderBy: { timestamp: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["disputes.dispute.review_started", "disputes.dispute.proposed"]);
    expect((await listPendingApprovalsFor(await carol())).some((r) => r.id === request.id)).toBe(true);
  });

  it("fighting a dispute requires an evidence summary, which is stored and copied into the request payload", async () => {
    const analyst = await bob();
    const dispute = await createDispute({ status: "IN_REVIEW", assignedToId: analyst.id });
    await expect(propose(analyst, dispute.id, { proposal: "fight", note: "we have proof" })).rejects.toBeInstanceOf(ValidationError);
    await expect(propose(analyst, dispute.id, { proposal: "fight", note: "we have proof", evidenceSummary: "   " })).rejects.toBeInstanceOf(ValidationError);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("IN_REVIEW");
    expect(await prisma.approvalRequest.count({ where: { entityId: dispute.id } })).toBe(0);

    const pending = await propose(analyst, dispute.id, { proposal: "fight", note: "we have proof", evidenceSummary: EVIDENCE });
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect(pending.evidenceSummary).toBe(EVIDENCE);
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: dispute.id } });
    expect(JSON.parse(request.payload)).toEqual({ proposal: "fight", evidenceSummary: EVIDENCE });
  });

  it("propose input schema enforces the proposal enum, note and evidence length, and rejects unknown keys", () => {
    expect(proposeInput.safeParse({ proposal: "accept", note: "ok" }).success).toBe(true);
    expect(proposeInput.safeParse({ proposal: "fight", note: "ok", evidenceSummary: EVIDENCE }).success).toBe(true);
    expect(proposeInput.safeParse({ proposal: "refund", note: "ok" }).success).toBe(false);
    expect(proposeInput.safeParse({ proposal: "accept", note: "" }).success).toBe(false);
    expect(proposeInput.safeParse({ proposal: "fight", note: "ok", evidenceSummary: "too short" }).success).toBe(false);
    expect(proposeInput.safeParse({ proposal: "accept", note: "ok", status: "ACCEPTED" }).success).toBe(false);
  });

  it("the maker cannot decide their own proposal; admin and auditor cannot decide at all", async () => {
    const requester = await bob();
    const { dispute, request } = await pendingFightDispute(requester.id);
    await expect(decideApproval({ requestId: request.id, deciderId: requester.id, decision: "confirm", note: "self" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideApproval({ requestId: request.id, deciderId: (await dan()).id, decision: "confirm", note: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideApproval({ requestId: request.id, deciderId: (await erin()).id, decision: "confirm", note: "auditor" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideApproval({ requestId: request.id, deciderId: (await alice()).id, decision: "confirm", note: "peer" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("PENDING_APPROVAL");
  });

  it("approver confirm sets CHALLENGED for a fight proposal and audits it; a second decision is rejected", async () => {
    const requester = await bob();
    const approver = await carol();
    const { dispute, request } = await pendingFightDispute(requester.id);
    const decided = await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "evidence is strong" });
    expect(decided.status).toBe("CONFIRMED");
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("CHALLENGED");
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "disputes.dispute.challenged", entityId: dispute.id } });
    expect(event.actorId).toBe(approver.id);
    expect(event.reason).toBe("evidence is strong");
    expect(JSON.parse(event.before ?? "{}").status).toBe("PENDING_APPROVAL");
    expect(JSON.parse(event.after ?? "{}").status).toBe("CHALLENGED");
    expect(await prisma.auditEvent.count({ where: { action: "approval.confirmed", entityId: request.id } })).toBe(1);
    await expect(decideApproval({ requestId: request.id, deciderId: approver.id, decision: "return", note: "again" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("approver confirm sets ACCEPTED for an accept proposal", async () => {
    const requester = await alice();
    const approver = await carol();
    const dispute = await createDispute({ status: "PENDING_APPROVAL", assignedToId: requester.id, proposal: "accept" });
    const request = await withTransaction((tx) =>
      createApprovalRequest(tx, {
        entityType: "disputes.dispute",
        entityId: dispute.id,
        action: "disputes.decision",
        payload: { proposal: "accept", evidenceSummary: null },
        requestedById: requester.id,
        requestNote: "accept it",
      }),
    );
    await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "agreed, write it off" });
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("ACCEPTED");
    expect(await prisma.auditEvent.count({ where: { action: "disputes.dispute.accepted", entityId: dispute.id } })).toBe(1);
  });

  it("approver return sends the dispute back to IN_REVIEW keeping the proposal and evidence for revision", async () => {
    const requester = await bob();
    const approver = await carol();
    const { dispute, request } = await pendingFightDispute(requester.id);
    await decideApproval({ requestId: request.id, deciderId: approver.id, decision: "return", note: "need the delivery scan" });
    const after = await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(after.status).toBe("IN_REVIEW");
    expect(after.proposal).toBe("fight");
    expect(after.evidenceSummary).toBe(EVIDENCE);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "disputes.dispute.returned", entityId: dispute.id } });
    expect(event.reason).toBe("need the delivery scan");
    expect(await prisma.auditEvent.count({ where: { action: "approval.returned", entityId: request.id } })).toBe(1);
    expect((await propose(requester, dispute.id, { proposal: "fight", note: "scan attached", evidenceSummary: `${EVIDENCE} Delivery scan added.` })).status).toBe("PENDING_APPROVAL");
  });

  it("a decision on a dispute that is no longer PENDING_APPROVAL fails and changes nothing", async () => {
    const requester = await bob();
    const approver = await carol();
    const { dispute, request } = await pendingFightDispute(requester.id);
    await prisma.dispute.update({ where: { id: dispute.id }, data: { status: "IN_REVIEW" } });
    await expect(decideApproval({ requestId: request.id, deciderId: approver.id, decision: "confirm", note: "stale" })).rejects.toBeInstanceOf(ValidationError);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("IN_REVIEW");
  });
});

describe("disputes PII", () => {
  beforeAll(() => loadApps());

  it("registers cardholderName and customerEmail as PII, and cardLast4 is not PII", () => {
    expect(DISPUTE_PII_FIELDS).toEqual(["cardholderName", "customerEmail"]);
    for (const field of DISPUTE_PII_FIELDS) expect(PII_FIELD_NAMES).toContain(field);
    expect(PII_FIELD_NAMES).not.toContain("cardLast4");
    expect(revealInput.safeParse({ field: "cardLast4", reason: "long enough reason" }).success).toBe(false);
    expect(revealInput.safeParse({ field: "nationalId", reason: "long enough reason" }).success).toBe(false);
    expect(revealInput.safeParse({ field: "customerEmail", reason: "long enough reason" }).success).toBe(true);
  });

  it("list and detail routes mask the PII fields but leave cardLast4 and references readable", async () => {
    const analyst = await alice();
    const dispute = await createDispute({ assignedToId: analyst.id });
    currentUser.value = analyst;
    const list = await listRoute(jsonRequest("GET", "/api/disputes"), { params: Promise.resolve({}) });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === dispute.id);
    expect(row).toBeDefined();
    expect(row?.cardholderName).toBe(MASK);
    expect(row?.customerEmail).toBe(MASK);
    expect(row?.cardLast4).toBe("4242");
    expect(row?.caseReference).toBe(dispute.caseReference);
    expect(row?.dueState).toBe("on_track");

    const detail = await detailRoute(jsonRequest("GET", `/api/disputes/${dispute.id}`), { params: Promise.resolve({ id: dispute.id }) });
    const body = (await detail.json()) as Record<string, unknown>;
    expect(body.cardholderName).toBe(MASK);
    expect(body.customerEmail).toBe(MASK);
    expect(body.cardLast4).toBe("4242");
    currentUser.value = null;
  });

  it("reveals each PII field to analyst/approver with a reason and audits it; admin/auditor are forbidden", async () => {
    const analyst = await alice();
    const dispute = await createDispute({ assignedToId: analyst.id });
    for (const field of DISPUTE_PII_FIELDS) {
      const result = await revealField({ user: analyst, entityType: "disputes.dispute", entityId: dispute.id, field, reason: "customer called about this chargeback" });
      expect(result).toEqual({ field, value: dispute[field] });
    }
    const viaApprover = await revealField({ user: await carol(), entityType: "disputes.dispute", entityId: dispute.id, field: "customerEmail", reason: "checking the sign-off" });
    expect(viaApprover.value).toBe("unit-test-customer@example.com");
    const reveals = await prisma.auditEvent.findMany({ where: { action: "pii.reveal", entityType: "disputes.dispute", entityId: dispute.id } });
    expect(reveals).toHaveLength(3);
    expect(reveals.map((e) => JSON.parse(e.after ?? "{}").field).sort()).toEqual(["cardholderName", "customerEmail", "customerEmail"]);
    expect(reveals.every((e) => e.reason && e.reason.length >= 10)).toBe(true);

    await expect(revealField({ user: await dan(), entityType: "disputes.dispute", entityId: dispute.id, field: "customerEmail", reason: "admin wants to look" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revealField({ user: await erin(), entityType: "disputes.dispute", entityId: dispute.id, field: "customerEmail", reason: "auditor wants to look" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reveal enforces the minimum reason length, the analyst's scope and the field list", async () => {
    const analyst = await alice();
    const own = await createDispute({ assignedToId: analyst.id });
    const foreign = await createDispute({ assignedToId: (await bob()).id });
    await expect(revealField({ user: analyst, entityType: "disputes.dispute", entityId: own.id, field: "customerEmail", reason: "short" })).rejects.toBeInstanceOf(ValidationError);
    await expect(revealField({ user: analyst, entityType: "disputes.dispute", entityId: foreign.id, field: "customerEmail", reason: "not my dispute but trying" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(revealField({ user: analyst, entityType: "disputes.dispute", entityId: own.id, field: "cardLast4", reason: "trying a non-PII field" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.auditEvent.count({ where: { action: "pii.reveal", entityId: { in: [own.id, foreign.id] } } })).toBe(0);
  });

  it("the reveal route rejects fields outside the dispute PII list with a generic 400 and returns the plain value otherwise", async () => {
    const analyst = await alice();
    const dispute = await createDispute({ assignedToId: analyst.id });
    currentUser.value = analyst;
    const ctx = { params: Promise.resolve({ id: dispute.id }) };
    expect((await revealRoute(jsonRequest("POST", `/api/disputes/${dispute.id}/reveal`, { field: "nationalId", reason: "long enough reason" }), ctx)).status).toBe(400);
    expect((await revealRoute(jsonRequest("POST", `/api/disputes/${dispute.id}/reveal`, { field: "cardLast4", reason: "long enough reason" }), ctx)).status).toBe(400);
    const ok = await revealRoute(jsonRequest("POST", `/api/disputes/${dispute.id}/reveal`, { field: "cardholderName", reason: "verifying the cardholder" }), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ field: "cardholderName", value: "Unit Test Cardholder (TEST)" });
    currentUser.value = null;
  });
});
