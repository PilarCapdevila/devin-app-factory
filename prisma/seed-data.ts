import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "../src/generated/prisma/client";

const RISK_FLAGS = ["pep", "sanctions_near_match", "high_risk_country", "adverse_media", "unusual_volume", "document_mismatch"];

export const SEED_USERS = [
  { email: "alice@example.com", name: "Alice Analyst", role: "analyst" },
  { email: "bob@example.com", name: "Bob Analyst", role: "analyst" },
  { email: "carol@example.com", name: "Carol Approver", role: "approver" },
  { email: "dan@example.com", name: "Dan Admin", role: "admin" },
  { email: "erin@example.com", name: "Erin Auditor", role: "auditor" },
] as const;

export const CASE_COUNT = 30;

function pickFlags(score: number): string[] {
  const count = score >= 75 ? 3 : score >= 40 ? 2 : score >= 15 ? 1 : 0;
  return faker.helpers.arrayElements(RISK_FLAGS, count);
}

/**
 * Deterministic seed (fixed faker seed). Users get the dev-only SEED_PASSWORD.
 * Cases: assigned to alice/bob in NEW or IN_REVIEW, a few unassigned, one APPROVED history,
 * and PENDING_APPROVAL cases recommended by alice so the approvals inbox is not empty.
 */
export async function seedDatabase(prisma: PrismaClient) {
  faker.seed(20260928);
  const password = process.env.SEED_PASSWORD ?? "password123";
  const passwordHash = await bcrypt.hash(password, 10);

  const users: Record<string, { id: string; role: string }> = {};
  for (const u of SEED_USERS) {
    const created = await prisma.user.create({ data: { ...u, passwordHash } });
    users[u.email] = created;
  }
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

  return { users, caseCount: CASE_COUNT + 1 };
}
