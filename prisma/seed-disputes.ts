import { faker } from "@faker-js/faker";
import type { PrismaClient } from "../src/generated/prisma/client";

export const DISPUTE_COUNT = 24;

const REASON_CODES = ["fraud", "not_recognised", "product_not_received", "duplicate_charge", "credit_not_processed", "cancelled_subscription"];
const CURRENCIES = ["EUR", "GBP", "USD"];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type SeedUser = { id: string; role: string };

/**
 * Deadline spread relative to seed time so every run has overdue, due-soon (< 72 h) and
 * comfortably-future disputes: slots 0–1 overdue, 2–3 due soon, the rest 5–30 days out.
 */
function respondByFor(i: number, now: number): Date {
  const slot = i % 8;
  if (slot <= 1) return new Date(now - (1 + slot * 2) * DAY);
  if (slot <= 3) return new Date(now + (6 + (slot - 2) * 40) * HOUR);
  return new Date(now + (5 + (slot - 4) * 8) * DAY);
}

function snapshot(dispute: Record<string, unknown>, overrides: Record<string, unknown>) {
  return JSON.stringify({ ...dispute, ...overrides });
}

/**
 * Deterministic dispute demo data (call after `faker.seed(...)`, users already created).
 * Statuses by index: NEW (some unassigned), IN_REVIEW (alice/bob), PENDING_APPROVAL (alice → accept,
 * bob → fight, each with a PENDING request), plus one ACCEPTED and one CHALLENGED with CONFIRMED requests.
 */
export async function seedDisputes(prisma: PrismaClient, users: Record<string, SeedUser>) {
  const alice = users["alice@example.com"];
  const bob = users["bob@example.com"];
  const carol = users["carol@example.com"];
  const dan = users["dan@example.com"];
  const now = Date.now();

  for (let i = 0; i < DISPUTE_COUNT; i++) {
    const slot = i % 12;
    const status =
      slot <= 3 ? "NEW" : slot <= 7 ? "IN_REVIEW" : slot <= 9 ? "PENDING_APPROVAL" : slot === 10 ? "ACCEPTED" : "CHALLENGED";
    const analyst = slot === 3 ? null : slot % 2 === 0 ? alice : bob;
    const proposal = status === "PENDING_APPROVAL" || status === "ACCEPTED" || status === "CHALLENGED" ? (analyst === alice ? "accept" : "fight") : null;
    const amountCents = faker.number.int({ min: 1500, max: 250000 });
    const data = {
      caseReference: `DSP-2026-${String(i + 1).padStart(4, "0")}`,
      paymentReference: `pay_${faker.string.alphanumeric({ length: 12, casing: "lower" })}`,
      amountCents,
      currency: faker.helpers.arrayElement(CURRENCIES),
      paymentDate: new Date(now - faker.number.int({ min: 10, max: 60 }) * DAY),
      reasonCode: faker.helpers.arrayElement(REASON_CODES),
      customerStatement: `${faker.lorem.sentence({ min: 8, max: 14 })} (TEST)`,
      cardholderName: `${faker.person.firstName()} ${faker.person.lastName()} (TEST)`,
      cardLast4: faker.string.numeric(4),
      customerEmail: `dispute-customer-${i + 1}@example.com`,
      respondBy: respondByFor(i, now),
      status,
      proposal,
      evidenceSummary:
        proposal === "fight"
          ? `Seeded evidence: signed delivery confirmation, matching device fingerprint and IP history for order ${faker.string.alphanumeric({ length: 8, casing: "upper" })}.`
          : null,
      assignedToId: analyst?.id ?? null,
    };
    const dispute = await prisma.dispute.create({ data });
    if (!analyst) continue;

    await prisma.auditEvent.create({
      data: {
        actorId: dan.id,
        actorRole: "admin",
        action: "disputes.dispute.assigned",
        entityType: "disputes.dispute",
        entityId: dispute.id,
        before: snapshot(dispute, { status: "NEW", assignedToId: null, proposal: null, evidenceSummary: null }),
        after: snapshot(dispute, { status: "NEW", proposal: null, evidenceSummary: null }),
      },
    });
    if (status === "NEW") continue;

    await prisma.auditEvent.create({
      data: {
        actorId: analyst.id,
        actorRole: "analyst",
        action: "disputes.dispute.review_started",
        entityType: "disputes.dispute",
        entityId: dispute.id,
        before: snapshot(dispute, { status: "NEW", proposal: null, evidenceSummary: null }),
        after: snapshot(dispute, { status: "IN_REVIEW", proposal: null, evidenceSummary: null }),
      },
    });
    if (status === "IN_REVIEW") continue;

    const note =
      proposal === "accept"
        ? `Seeded proposal: accept — ${data.reasonCode.replace(/_/g, " ")} is credible and the amount is below the evidence threshold.`
        : `Seeded proposal: fight — delivery and device evidence contradicts the ${data.reasonCode.replace(/_/g, " ")} claim.`;
    const final = status !== "PENDING_APPROVAL";
    const request = await prisma.approvalRequest.create({
      data: {
        entityType: "disputes.dispute",
        entityId: dispute.id,
        action: "disputes.decision",
        payload: JSON.stringify({ proposal, evidenceSummary: data.evidenceSummary }),
        requestedById: analyst.id,
        requestNote: note,
        ...(final ? { status: "CONFIRMED", decidedById: carol.id, decidedAt: new Date(now), decisionNote: "Seeded: confirmed." } : {}),
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: analyst.id,
        actorRole: "analyst",
        action: "approval.requested",
        entityType: "approval.request",
        entityId: request.id,
        after: JSON.stringify({ ...request, status: "PENDING", decidedById: null, decidedAt: null, decisionNote: null }),
        reason: note,
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: analyst.id,
        actorRole: "analyst",
        action: "disputes.dispute.proposed",
        entityType: "disputes.dispute",
        entityId: dispute.id,
        before: snapshot(dispute, { status: "IN_REVIEW", proposal: null, evidenceSummary: null }),
        after: snapshot(dispute, { status: "PENDING_APPROVAL" }),
        reason: note,
      },
    });
    if (!final) continue;

    await prisma.auditEvent.create({
      data: {
        actorId: carol.id,
        actorRole: "approver",
        action: "approval.confirmed",
        entityType: "approval.request",
        entityId: request.id,
        before: JSON.stringify({ ...request, status: "PENDING", decidedById: null, decidedAt: null, decisionNote: null }),
        after: JSON.stringify(request),
        reason: request.decisionNote,
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId: carol.id,
        actorRole: "approver",
        action: status === "ACCEPTED" ? "disputes.dispute.accepted" : "disputes.dispute.challenged",
        entityType: "disputes.dispute",
        entityId: dispute.id,
        before: snapshot(dispute, { status: "PENDING_APPROVAL" }),
        after: JSON.stringify(dispute),
        reason: request.decisionNote,
      },
    });
  }

  return { disputeCount: DISPUTE_COUNT };
}
