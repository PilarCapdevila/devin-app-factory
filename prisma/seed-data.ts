import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "../src/generated/prisma/client";
import { seedDisputes } from "./seed-disputes";

const RISK_FLAGS = ["pep", "sanctions_near_match", "high_risk_country", "adverse_media", "unusual_volume", "document_mismatch"];

export const SEED_USERS = [
  { email: "alice@example.com", name: "Alice Analyst", role: "analyst" },
  { email: "bob@example.com", name: "Bob Analyst", role: "analyst" },
  { email: "carol@example.com", name: "Carol Approver", role: "approver" },
  { email: "grace@example.com", name: "Grace Approver", role: "approver" },
  { email: "dan@example.com", name: "Dan Admin", role: "admin" },
  { email: "erin@example.com", name: "Erin Auditor", role: "auditor" },
  { email: "frank@example.com", name: "Frank Support", role: "support_agent" },
] as const;

export const CASE_COUNT = 30;
export const REFUND_COUNT = 20;

const REFUND_REASONS = [
  "Duplicate charge",
  "Order cancelled before shipment",
  "Item returned by customer",
  "Service not delivered",
  "Customer disputed subscription renewal",
  "Pricing error at checkout",
];
const DAY_MS = 24 * 60 * 60 * 1000;

function pickFlags(score: number): string[] {
  const count = score >= 75 ? 3 : score >= 40 ? 2 : score >= 15 ? 1 : 0;
  return faker.helpers.arrayElements(RISK_FLAGS, count);
}

/**
 * Deterministic seed (fixed faker seed). Users get the dev-only SEED_PASSWORD.
 * Cases: assigned to alice/bob in NEW or IN_REVIEW, a few unassigned, one APPROVED history,
 * and PENDING_APPROVAL cases recommended by alice so the approvals inbox is not empty.
 */
/** Creates any SEED_USERS missing from the database (idempotent; existing users are left untouched). */
export async function ensureSeedUsers(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(process.env.SEED_PASSWORD ?? "password123", 10);
  const users: Record<string, { id: string; role: string }> = {};
  const created: string[] = [];
  for (const u of SEED_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      users[u.email] = existing;
    } else {
      users[u.email] = await prisma.user.create({ data: { ...u, passwordHash } });
      created.push(u.email);
    }
  }
  return { users, created };
}

export async function seedDatabase(prisma: PrismaClient) {
  faker.seed(20260928);
  const { users } = await ensureSeedUsers(prisma);
  const alice = users["alice@example.com"];
  const bob = users["bob@example.com"];
  const carol = users["carol@example.com"];
  const dan = users["dan@example.com"];

  for (let i = 0; i < CASE_COUNT; i++) {
    const riskScore = faker.number.int({ min: 0, max: 100 });
    const applicantName = `${faker.person.firstName()} ${faker.person.lastName()} (TEST)`;
    const data = {
      applicantName,
      dateOfBirth: faker.date.birthdate({ min: 18, max: 80, mode: "age" }).toISOString().slice(0, 10),
      nationalId: `TEST-${faker.string.numeric(8)}`,
      address: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.zipCode()} (fake)`,
      riskScore,
      riskFlags: JSON.stringify(pickFlags(riskScore)),
    };

    // Deterministic distribution by index.
    const slot = i % 10;
    if (slot === 9) {
      await prisma.kycCase.create({ data: { ...data, status: "NEW" } });
      continue;
    }
    const status = slot <= 3 ? "NEW" : slot <= 6 ? "IN_REVIEW" : slot === 7 ? "PENDING_APPROVAL" : "IN_REVIEW";
    const analyst = status === "PENDING_APPROVAL" || slot % 2 === 0 ? alice : bob;
    const kycCase = await prisma.kycCase.create({ data: { ...data, status, assignedToId: analyst.id } });

    await prisma.auditEvent.create({
      data: {
        actorId: dan.id,
        actorRole: "admin",
        action: "kyc.case.assigned",
        entityType: "kyc.case",
        entityId: kycCase.id,
        before: JSON.stringify({ ...kycCase, status: "NEW", assignedToId: null }),
        after: JSON.stringify({ ...kycCase, status: "NEW" }),
      },
    });

    if (status === "IN_REVIEW" || status === "PENDING_APPROVAL") {
      await prisma.auditEvent.create({
        data: {
          actorId: analyst.id,
          actorRole: "analyst",
          action: "kyc.case.review_started",
          entityType: "kyc.case",
          entityId: kycCase.id,
          before: JSON.stringify({ ...kycCase, status: "NEW" }),
          after: JSON.stringify({ ...kycCase, status: "IN_REVIEW" }),
        },
      });
    }

    if (status === "PENDING_APPROVAL") {
      const recommendation = riskScore >= 60 ? "reject" : "approve";
      const note = `Seeded recommendation: ${recommendation} based on risk score ${riskScore}.`;
      const request = await prisma.approvalRequest.create({
        data: {
          entityType: "kyc.case",
          entityId: kycCase.id,
          action: "kyc.decision",
          payload: JSON.stringify({ recommendation }),
          requestedById: alice.id,
          requestNote: note,
        },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: alice.id,
          actorRole: "analyst",
          action: "approval.requested",
          entityType: "approval.request",
          entityId: request.id,
          after: JSON.stringify(request),
          reason: note,
        },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: alice.id,
          actorRole: "analyst",
          action: "kyc.case.recommended",
          entityType: "kyc.case",
          entityId: kycCase.id,
          before: JSON.stringify({ ...kycCase, status: "IN_REVIEW" }),
          after: JSON.stringify({ ...kycCase, status: "PENDING_APPROVAL" }),
          reason: note,
        },
      });
    }
  }

  // One completed case so the demo shows a final outcome reached through the approvals engine.
  const approved = await prisma.kycCase.create({
    data: {
      applicantName: "Sample Approved Applicant (TEST)",
      dateOfBirth: "1985-06-15",
      nationalId: "TEST-00000001",
      address: "1 Example Street, Testville, 00000 (fake)",
      riskScore: 12,
      riskFlags: JSON.stringify([]),
      status: "APPROVED",
      assignedToId: bob.id,
    },
  });
  const approvedRequest = await prisma.approvalRequest.create({
    data: {
      entityType: "kyc.case",
      entityId: approved.id,
      action: "kyc.decision",
      payload: JSON.stringify({ recommendation: "approve" }),
      requestedById: bob.id,
      requestNote: "Seeded: low risk, documents verified.",
      status: "CONFIRMED",
      decidedById: carol.id,
      decidedAt: new Date(),
      decisionNote: "Seeded: confirmed.",
    },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: carol.id,
      actorRole: "approver",
      action: "approval.confirmed",
      entityType: "approval.request",
      entityId: approvedRequest.id,
      before: JSON.stringify({ ...approvedRequest, status: "PENDING", decidedById: null, decidedAt: null, decisionNote: null }),
      after: JSON.stringify(approvedRequest),
      reason: approvedRequest.decisionNote,
    },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: carol.id,
      actorRole: "approver",
      action: "kyc.case.approved",
      entityType: "kyc.case",
      entityId: approved.id,
      before: JSON.stringify({ ...approved, status: "PENDING_APPROVAL" }),
      after: JSON.stringify(approved),
      reason: approvedRequest.decisionNote,
    },
  });

  const refundCount = await seedRefunds(prisma, users);
  const { disputeCount } = await seedDisputes(prisma, users);

  return { users, caseCount: CASE_COUNT + 1, refundCount, disputeCount };
}

/**
 * Refunds (src/apps/refunds): 20 USD refunds from $15 to $5,000, all requested by frank, in a
 * fixed 2:2:1 rotation of PENDING_APPROVAL / ISSUED / RETURNED. Issued refunds carry the
 * CONFIRMED request, its confirmations (carol alone up to $2,000.00; carol then grace above
 * it), the MockPaymentCall keyed by that request's id and the audit trail the approval action
 * would have written; three of them are issued "today" for the dashboard tiles.
 */
async function seedRefunds(prisma: PrismaClient, users: Record<string, { id: string; role: string }>) {
  const frank = users["frank@example.com"];
  const carol = users["carol@example.com"];
  const grace = users["grace@example.com"];
  const now = Date.now();

  for (let i = 0; i < REFUND_COUNT; i++) {
    const amountCents = i === 0 ? 1500 : i === REFUND_COUNT - 1 ? 500000 : faker.number.int({ min: 15, max: 5000 }) * 100;
    const slot = i % 5;
    const status = slot <= 1 ? "PENDING_APPROVAL" : slot <= 3 ? "ISSUED" : "RETURNED";
    const issuedToday = status === "ISSUED" && i < 10;
    const createdAt = new Date(now - (status === "PENDING_APPROVAL" ? i : issuedToday ? 0 : i + 2) * DAY_MS);
    const reason = faker.helpers.arrayElement(REFUND_REASONS);
    const refund = await prisma.refund.create({
      data: {
        paymentId: `pay_TEST${faker.string.alphanumeric({ length: 12, casing: "upper" })}`,
        customerName: `${faker.person.firstName()} ${faker.person.lastName()} (TEST)`,
        customerEmail: `test.${faker.internet.username().toLowerCase()}@example.com`,
        cardLast4: faker.string.numeric(4),
        amountCents,
        currency: "USD",
        reason,
        status,
        requestedById: frank.id,
        createdAt,
        updatedAt: createdAt,
        issuedAt: status === "ISSUED" ? (issuedToday ? new Date(now) : new Date(createdAt.getTime() + DAY_MS)) : null,
      },
    });
    const requestNote = `Seeded request: ${reason.toLowerCase()}.`;
    const decided = status !== "PENDING_APPROVAL";
    const decisionNote = status === "ISSUED" ? "Seeded: verified with the customer, refund issued." : "Seeded: returned, evidence missing.";
    const approvalsRequired = amountCents > 200_000 ? 2 : 1;
    const twoStep = status === "ISSUED" && approvalsRequired === 2;
    const finalApprover = twoStep ? grace : carol;
    const decidedAt = decided ? refund.issuedAt ?? new Date(createdAt.getTime() + DAY_MS) : null;
    const request = await prisma.approvalRequest.create({
      data: {
        entityType: "refunds.refund",
        entityId: refund.id,
        action: "refunds.issue",
        payload: JSON.stringify({ paymentId: refund.paymentId, amountCents, currency: "USD" }),
        requestedById: frank.id,
        requestedAt: createdAt,
        requestNote,
        status: status === "ISSUED" ? "CONFIRMED" : status === "RETURNED" ? "RETURNED" : "PENDING",
        decidedById: decided ? finalApprover.id : null,
        decidedAt,
        decisionNote: decided ? decisionNote : null,
      },
    });
    const pendingRefund = { ...refund, status: "PENDING_APPROVAL", issuedAt: null };
    const pendingRequest = { ...request, status: "PENDING", decidedById: null, decidedAt: null, decisionNote: null };
    await prisma.auditEvent.create({
      data: {
        actorId: frank.id,
        actorRole: "support_agent",
        action: "refunds.refund.requested",
        entityType: "refunds.refund",
        entityId: refund.id,
        after: JSON.stringify(pendingRefund),
        reason: requestNote,
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: frank.id,
        actorRole: "support_agent",
        action: "approval.requested",
        entityType: "approval.request",
        entityId: request.id,
        after: JSON.stringify(pendingRequest),
        reason: requestNote,
      },
    });
    if (!decided) continue;

    if (twoStep) {
      const stepNote = "Seeded: first approval, amount over $2,000 needs a second approver.";
      const stepAt = new Date(decidedAt!.getTime() - 60 * 60 * 1000);
      await prisma.approvalConfirmation.create({ data: { requestId: request.id, approverId: carol.id, confirmedAt: stepAt, note: stepNote } });
      await prisma.auditEvent.create({
        data: {
          actorId: carol.id,
          actorRole: "approver",
          action: "approval.step_confirmed",
          entityType: "approval.request",
          entityId: request.id,
          before: JSON.stringify({ ...pendingRequest, approvalsGiven: 0, approvalsRequired }),
          after: JSON.stringify({ ...pendingRequest, approvalsGiven: 1, approvalsRequired }),
          reason: stepNote,
        },
      });
    }
    if (status === "ISSUED") {
      await prisma.approvalConfirmation.create({ data: { requestId: request.id, approverId: finalApprover.id, confirmedAt: decidedAt!, note: decisionNote } });
      await prisma.mockPaymentCall.create({
        data: { paymentId: refund.paymentId, amountCents, idempotencyKey: request.id, providerRefundId: `mock_re_${request.id}` },
      });
    }
    await prisma.auditEvent.create({
      data: {
        actorId: finalApprover.id,
        actorRole: "approver",
        action: status === "ISSUED" ? "refunds.refund.issued" : "refunds.refund.returned",
        entityType: "refunds.refund",
        entityId: refund.id,
        before: JSON.stringify(pendingRefund),
        after: JSON.stringify(refund),
        reason: decisionNote,
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: finalApprover.id,
        actorRole: "approver",
        action: status === "ISSUED" ? "approval.confirmed" : "approval.returned",
        entityType: "approval.request",
        entityId: request.id,
        before: JSON.stringify(pendingRequest),
        after: JSON.stringify(request),
        reason: decisionNote,
      },
    });
  }
  return REFUND_COUNT;
}
