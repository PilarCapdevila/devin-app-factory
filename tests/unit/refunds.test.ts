import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/platform/auth";

const currentUser = vi.hoisted(() => ({ value: null as SessionUser | null }));
vi.mock("@/platform/auth", () => ({ getCurrentUser: async () => currentUser.value }));

import { getRefund, listRefunds, requestRefund, startOfUtcDay, summarizeRefunds } from "@/apps/refunds/refunds";
import { visibleWhere } from "@/apps/refunds/visibleWhere";
import { POST as decideRoute } from "@/app/api/approvals/[id]/decide/route";
import { GET as getRefundRoute } from "@/app/api/refunds/[id]/route";
import { POST as revealRoute } from "@/app/api/refunds/[id]/reveal/route";
import { GET as listRoute, POST as requestRoute } from "@/app/api/refunds/route";
import { mockPaymentsConnector } from "@/connectors/payments";
import { loadApps } from "@/platform/apps";
import { decideApproval, listPendingApprovalsFor } from "@/platform/approvals";
import { prisma, withTransaction } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { MASK, revealField } from "@/platform/pii";
import { alice, carol, createRefund, dan, erin, frank, jsonRequest } from "./helpers";

vi.spyOn(console, "error").mockImplementation(() => {});

const REQUEST = {
  paymentId: "pay_UNIT_NEW",
  customerName: "New Customer (TEST)",
  customerEmail: "new.customer@example.com",
  cardLast4: "1234",
  amountCents: 2500,
  currency: "USD",
  reason: "Duplicate charge reported by customer",
};

async function auditActions(entityId: string) {
  return (await prisma.auditEvent.findMany({ where: { entityId }, orderBy: { timestamp: "asc" } })).map((e) => e.action);
}

describe("Refunds record-level access", () => {
  it("visibleWhere is the empty scope for every role that may read refunds", async () => {
    for (const user of await Promise.all([frank(), carol(), dan(), erin(), alice()])) expect(visibleWhere(user)).toEqual({});
  });

  it("listRefunds returns every seeded refund to agents and approvers, newest first", async () => {
    const agent = await frank();
    const refunds = await listRefunds(agent);
    expect(refunds.length).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < refunds.length; i++) expect(refunds[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(refunds[i].createdAt.getTime());
    expect(new Set(refunds.map((r) => r.status))).toEqual(new Set(["PENDING_APPROVAL", "ISSUED", "RETURNED"]));
    expect((await listRefunds(await carol())).length).toBe(refunds.length);
  });

  it("filters by status and amount range", async () => {
    const agent = await frank();
    const filtered = await listRefunds(agent, { status: "ISSUED", minAmountCents: 10_000, maxAmountCents: 200_000 });
    expect(filtered.every((r) => r.status === "ISSUED" && r.amountCents >= 10_000 && r.amountCents <= 200_000)).toBe(true);
    const seedRange = await listRefunds(agent, { minAmountCents: 1500, maxAmountCents: 500_000 });
    expect(seedRange.some((r) => r.amountCents === 1500)).toBe(true);
    expect(seedRange.some((r) => r.amountCents === 500_000)).toBe(true);
    expect(await listRefunds(agent, { maxAmountCents: 1 })).toEqual([]);
  });

  it("getRefund returns the refund with its audit trail and approval requests, or 404 for an unknown id", async () => {
    const { refund, request } = await createRefund();
    const detail = await getRefund(await frank(), refund.id);
    expect(detail.id).toBe(refund.id);
    expect(detail.approvalRequests.map((r) => r.id)).toEqual([request?.id]);
    expect(Array.isArray(detail.auditTrail)).toBe(true);
    await expect(getRefund(await frank(), "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRefund(await carol(), "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("summary counts pending refunds and refunds issued in the current UTC day", async () => {
    const agent = await frank();
    const before = await summarizeRefunds(agent);
    const { refund } = await createRefund({ amountCents: 777 });
    const after = await summarizeRefunds(agent);
    expect(after.pending.count).toBe(before.pending.count + 1);
    expect(after.pending.totalCents).toBe(before.pending.totalCents + 777);
    expect(after.issuedToday.count).toBe(before.issuedToday.count);
    await prisma.refund.update({ where: { id: refund.id }, data: { status: "ISSUED", issuedAt: new Date() } });
    const issued = await summarizeRefunds(agent);
    expect(issued.issuedToday.count).toBe(before.issuedToday.count + 1);
    expect(issued.issuedToday.totalCents).toBe(before.issuedToday.totalCents + 777);
    const tomorrow = new Date(startOfUtcDay().getTime() + 24 * 60 * 60 * 1000);
    expect((await summarizeRefunds(agent, tomorrow)).issuedToday).toEqual({ count: 0, totalCents: 0 });
  });
});

describe("Refunds workflow", () => {
  beforeAll(() => loadApps());

  it("maker step creates the refund in PENDING_APPROVAL with its approval request and audit event in one transaction", async () => {
    const agent = await frank();
    const refund = await requestRefund(agent, { ...REQUEST, paymentId: "pay_UNIT_MAKER" });
    expect(refund.status).toBe("PENDING_APPROVAL");
    expect(refund.requestedById).toBe(agent.id);
    expect(refund.issuedAt).toBeNull();

    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "refunds.refund", entityId: refund.id } });
    expect(request.status).toBe("PENDING");
    expect(request.action).toBe("refunds.issue");
    expect(request.requestedById).toBe(agent.id);
    expect(request.requestNote).toBe(REQUEST.reason);
    expect(JSON.parse(request.payload)).toEqual({ paymentId: "pay_UNIT_MAKER", amountCents: 2500, currency: "USD" });

    expect(await auditActions(refund.id)).toEqual(["refunds.refund.requested"]);
    expect(await auditActions(request.id)).toEqual(["approval.requested"]);
    expect((await listPendingApprovalsFor(await carol())).some((r) => r.id === request.id)).toBe(true);
    expect((await listPendingApprovalsFor(agent)).some((r) => r.id === request.id)).toBe(false);
  });

  it("rejects a second request while one is pending for the same payment, allows one after a return", async () => {
    const agent = await frank();
    const first = await requestRefund(agent, { ...REQUEST, paymentId: "pay_UNIT_DUP" });
    await expect(requestRefund(agent, { ...REQUEST, paymentId: "pay_UNIT_DUP" })).rejects.toBeInstanceOf(ValidationError);
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: first.id } });
    await decideApproval({ requestId: request.id, deciderId: (await carol()).id, decision: "return", note: "missing evidence" });
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("RETURNED");
    const second = await requestRefund(agent, { ...REQUEST, paymentId: "pay_UNIT_DUP" });
    expect(second.status).toBe("PENDING_APPROVAL");
    expect(second.id).not.toBe(first.id);
  });

  it("confirm issues the refund through the connector exactly once, keyed by the request id, and audits it", async () => {
    const approver = await carol();
    const { refund, request } = await createRefund({ amountCents: 12_345 });
    const callsBefore = await prisma.mockPaymentCall.count();

    const decided = await decideApproval({ requestId: request!.id, deciderId: approver.id, decision: "confirm", note: "verified with customer" });
    expect(decided.status).toBe("CONFIRMED");

    const issued = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(issued.status).toBe("ISSUED");
    expect(issued.issuedAt).not.toBeNull();

    const call = await prisma.mockPaymentCall.findUniqueOrThrow({ where: { idempotencyKey: request!.id } });
    expect(call).toMatchObject({ paymentId: refund.paymentId, amountCents: 12_345 });
    expect(await prisma.mockPaymentCall.count()).toBe(callsBefore + 1);

    expect(await auditActions(refund.id)).toEqual(["refunds.refund.issued"]);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "refunds.refund.issued", entityId: refund.id } });
    expect(event.actorId).toBe(approver.id);
    expect(event.reason).toBe("verified with customer");
    expect(JSON.parse(event.before!).status).toBe("PENDING_APPROVAL");
    expect(JSON.parse(event.after!)).toMatchObject({ status: "ISSUED", providerRefundId: call.providerRefundId });
    expect(await auditActions(request!.id)).toEqual(["approval.confirmed"]);

    await expect(decideApproval({ requestId: request!.id, deciderId: approver.id, decision: "confirm", note: "again" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.mockPaymentCall.count()).toBe(callsBefore + 1);
  });

  it("return marks the refund RETURNED without calling the connector", async () => {
    const approver = await carol();
    const { refund, request } = await createRefund();
    const callsBefore = await prisma.mockPaymentCall.count();
    await decideApproval({ requestId: request!.id, deciderId: approver.id, decision: "return", note: "customer already refunded" });
    const returned = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(returned.status).toBe("RETURNED");
    expect(returned.issuedAt).toBeNull();
    expect(await prisma.mockPaymentCall.count()).toBe(callsBefore);
    expect(await auditActions(refund.id)).toEqual(["refunds.refund.returned"]);
    expect(await auditActions(request!.id)).toEqual(["approval.returned"]);
  });

  it("maker-checker: the requester, an admin and an analyst cannot decide; nothing is issued", async () => {
    const { refund, request } = await createRefund();
    for (const decider of await Promise.all([frank(), dan(), alice(), erin()])) {
      await expect(decideApproval({ requestId: request!.id, deciderId: decider.id, decision: "confirm", note: "trying" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("PENDING_APPROVAL");
    expect(await prisma.mockPaymentCall.count({ where: { idempotencyKey: request!.id } })).toBe(0);
  });

  it("a refund that is no longer pending cannot be confirmed or returned", async () => {
    const approver = await carol();
    const issued = await createRefund({ status: "ISSUED", withRequest: false });
    const stale = await prisma.approvalRequest.create({
      data: {
        entityType: "refunds.refund",
        entityId: issued.refund.id,
        action: "refunds.issue",
        payload: "{}",
        requestedById: (await frank()).id,
        requestNote: "stale",
      },
    });
    await expect(decideApproval({ requestId: stale.id, deciderId: approver.id, decision: "confirm", note: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(decideApproval({ requestId: stale.id, deciderId: approver.id, decision: "return", note: "x" })).rejects.toBeInstanceOf(ValidationError);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("PENDING");
    expect(await prisma.mockPaymentCall.count({ where: { idempotencyKey: stale.id } })).toBe(0);
  });
});

describe("Payments connector", () => {
  it("mock records each call and replays the same idempotency key without a second call", async () => {
    const key = `unit-key-${Date.now()}`;
    const result = await withTransaction((tx) => mockPaymentsConnector(tx).issueRefund({ paymentId: "pay_UNIT_CONN", amountCents: 100, idempotencyKey: key }));
    expect(result.replayed).toBe(false);
    const replay = await withTransaction((tx) => mockPaymentsConnector(tx).issueRefund({ paymentId: "pay_UNIT_CONN", amountCents: 100, idempotencyKey: key }));
    expect(replay).toEqual({ providerRefundId: result.providerRefundId, replayed: true });
    expect(await prisma.mockPaymentCall.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("is imported only by the refunds approval action (src/apps/refunds/register.ts)", () => {
    const root = path.resolve(__dirname, "../../src");
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const file = path.join(dir, entry);
        if (statSync(file).isDirectory()) {
          if (entry !== "generated") walk(file);
        } else if (/\.(ts|tsx)$/.test(entry) && readFileSync(file, "utf8").includes("connectors/payments")) {
          importers.push(path.relative(root, file));
        }
      }
    };
    walk(root);
    expect(importers.sort()).toEqual(["apps/refunds/register.ts"]);
  });
});

describe("Refund PII", () => {
  it("customerEmail is masked in list and detail responses, cardLast4 is not", async () => {
    currentUser.value = await frank();
    const { refund } = await createRefund();
    const list = await listRoute(jsonRequest("GET", "/api/refunds?status=PENDING_APPROVAL"), { params: Promise.resolve({}) });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string; customerEmail: string; cardLast4: string }[];
    const row = rows.find((r) => r.id === refund.id)!;
    expect(row.customerEmail).toBe(MASK);
    expect(row.cardLast4).toBe("4242");
    const detail = await getRefundRoute(jsonRequest("GET", `/api/refunds/${refund.id}`), { params: Promise.resolve({ id: refund.id }) });
    const body = (await detail.json()) as { customerEmail: string; auditTrail: { after: { customerEmail?: string } | null }[] };
    expect(body.customerEmail).toBe(MASK);
    expect(JSON.stringify(body)).not.toContain("unit.customer@example.com");
  });

  it("reveal requires pii.reveal, a reason of 10+ characters, a PII field and a visible record", async () => {
    const { refund } = await createRefund();
    const approver = await carol();
    await expect(revealField({ user: await frank(), entityType: "refunds.refund", entityId: refund.id, field: "customerEmail", reason: "contacting the customer" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revealField({ user: await dan(), entityType: "refunds.refund", entityId: refund.id, field: "customerEmail", reason: "contacting the customer" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revealField({ user: approver, entityType: "refunds.refund", entityId: refund.id, field: "customerEmail", reason: "short" })).rejects.toBeInstanceOf(ValidationError);
    await expect(revealField({ user: approver, entityType: "refunds.refund", entityId: refund.id, field: "cardLast4", reason: "contacting the customer" })).rejects.toBeInstanceOf(ValidationError);
    await expect(revealField({ user: approver, entityType: "refunds.refund", entityId: "missing", field: "customerEmail", reason: "contacting the customer" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.auditEvent.count({ where: { action: "pii.reveal", entityId: refund.id } })).toBe(0);

    const result = await revealField({ user: approver, entityType: "refunds.refund", entityId: refund.id, field: "customerEmail", reason: "contacting the customer" });
    expect(result).toEqual({ field: "customerEmail", value: "unit.customer@example.com" });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "pii.reveal", entityId: refund.id } });
    expect(event.actorId).toBe(approver.id);
    expect(event.reason).toBe("contacting the customer");
    expect(event.after).not.toContain("unit.customer");
  });
});

describe("Refund routes", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("POST /api/refunds is the maker step for support agents and 403 (audited) for everyone else", async () => {
    currentUser.value = await frank();
    const ok = await requestRoute(jsonRequest("POST", "/api/refunds", { ...REQUEST, paymentId: "pay_UNIT_ROUTE" }), ctx(""));
    expect(ok.status).toBe(200);
    const created = (await ok.json()) as { id: string; status: string; customerEmail: string };
    expect(created.status).toBe("PENDING_APPROVAL");
    expect(created.customerEmail).toBe(MASK);

    const bad = await requestRoute(jsonRequest("POST", "/api/refunds", { ...REQUEST, paymentId: "pay_UNIT_ROUTE2", cardLast4: "12a4" }), ctx(""));
    expect(bad.status).toBe(400);
    const extra = await requestRoute(jsonRequest("POST", "/api/refunds", { ...REQUEST, paymentId: "pay_UNIT_ROUTE3", status: "ISSUED" }), ctx(""));
    expect(extra.status).toBe(400);

    for (const user of await Promise.all([carol(), dan(), erin(), alice()])) {
      currentUser.value = user;
      const denied = await requestRoute(jsonRequest("POST", "/api/refunds", { ...REQUEST, paymentId: "pay_UNIT_DENIED" }), ctx(""));
      expect(denied.status).toBe(403);
      expect(await prisma.auditEvent.count({ where: { action: "access.denied", actorId: user.id, entityId: "POST /api/refunds" } })).toBeGreaterThan(0);
    }
    expect(await prisma.refund.count({ where: { paymentId: "pay_UNIT_DENIED" } })).toBe(0);
  });

  it("GET /api/refunds is 403 for analysts and 200 for admin and auditor; unknown ids are 404", async () => {
    currentUser.value = await alice();
    expect((await listRoute(jsonRequest("GET", "/api/refunds"), ctx(""))).status).toBe(403);
    for (const user of await Promise.all([dan(), erin()])) {
      currentUser.value = user;
      expect((await listRoute(jsonRequest("GET", "/api/refunds"), ctx(""))).status).toBe(200);
      expect((await getRefundRoute(jsonRequest("GET", "/api/refunds/nope"), ctx("nope"))).status).toBe(404);
    }
    currentUser.value = await frank();
    expect((await listRoute(jsonRequest("GET", "/api/refunds?bogus=1"), ctx(""))).status).toBe(400);
  });

  it("reveal route returns the raw value only to pii.reveal holders", async () => {
    const { refund } = await createRefund();
    currentUser.value = await frank();
    expect((await revealRoute(jsonRequest("POST", `/api/refunds/${refund.id}/reveal`, { field: "customerEmail", reason: "contacting the customer" }), ctx(refund.id))).status).toBe(403);
    currentUser.value = await carol();
    expect((await revealRoute(jsonRequest("POST", `/api/refunds/${refund.id}/reveal`, { field: "customerEmail", reason: "short" }), ctx(refund.id))).status).toBe(400);
    const ok = await revealRoute(jsonRequest("POST", `/api/refunds/${refund.id}/reveal`, { field: "customerEmail", reason: "contacting the customer" }), ctx(refund.id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ field: "customerEmail", value: "unit.customer@example.com" });
  });

  it("decide route: admin gets 403, the requester gets 403, the approver confirms and the refund is issued", async () => {
    const { refund, request } = await createRefund();
    const body = { decision: "confirm", note: "approved via route" };
    currentUser.value = await dan();
    expect((await decideRoute(jsonRequest("POST", `/api/approvals/${request!.id}/decide`, body), ctx(request!.id))).status).toBe(403);
    currentUser.value = await frank();
    expect((await decideRoute(jsonRequest("POST", `/api/approvals/${request!.id}/decide`, body), ctx(request!.id))).status).toBe(403);
    currentUser.value = await carol();
    expect((await decideRoute(jsonRequest("POST", `/api/approvals/${request!.id}/decide`, body), ctx(request!.id))).status).toBe(200);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("ISSUED");
    expect(await prisma.mockPaymentCall.count({ where: { idempotencyKey: request!.id } })).toBe(1);
  });
});
