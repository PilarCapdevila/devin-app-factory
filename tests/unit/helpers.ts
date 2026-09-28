import type { SessionUser } from "@/platform/auth";
import { prisma } from "@/platform/db";
import type { Role } from "@/platform/permissions";

export async function userByEmail(email: string): Promise<SessionUser> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: user.id, email: user.email, name: user.name, role: user.role as Role };
}

export const alice = () => userByEmail("alice@example.com");
export const bob = () => userByEmail("bob@example.com");
export const carol = () => userByEmail("carol@example.com");
export const dan = () => userByEmail("dan@example.com");
export const erin = () => userByEmail("erin@example.com");
export const frank = () => userByEmail("frank@example.com");
export const grace = () => userByEmail("grace@example.com");

/** Creates an isolated case so tests do not depend on the seed's state machine positions. */
export async function createCase(overrides: { status?: string; assignedToId?: string | null } = {}) {
  return prisma.kycCase.create({
    data: {
      applicantName: "Unit Test Applicant (TEST)",
      dateOfBirth: "1990-01-01",
      nationalId: "TEST-12345678",
      address: "1 Test Street, Testville (fake)",
      riskScore: 50,
      riskFlags: JSON.stringify(["pep"]),
      status: overrides.status ?? "NEW",
      assignedToId: overrides.assignedToId ?? null,
    },
  });
}

export function jsonRequest(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Creates an isolated dispute so tests do not depend on the seed's state machine positions. */
export async function createDispute(
  overrides: { status?: string; assignedToId?: string | null; respondBy?: Date; proposal?: string | null; evidenceSummary?: string | null } = {},
) {
  return prisma.dispute.create({
    data: {
      caseReference: `DSP-TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      paymentReference: "pay_unittest0001",
      amountCents: 12_345,
      currency: "EUR",
      paymentDate: new Date("2026-09-01T10:00:00Z"),
      reasonCode: "not_recognised",
      customerStatement: "I do not recognise this payment (TEST)",
      cardholderName: "Unit Test Cardholder (TEST)",
      cardLast4: "4242",
      customerEmail: "unit-test-customer@example.com",
      respondBy: overrides.respondBy ?? new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      status: overrides.status ?? "NEW",
      assignedToId: overrides.assignedToId ?? null,
      proposal: overrides.proposal ?? null,
      evidenceSummary: overrides.evidenceSummary ?? null,
    },
  });
}

/** Creates an isolated refund (with its approval request when pending) requested by frank. */
export async function createRefund(overrides: { status?: string; paymentId?: string; amountCents?: number; withRequest?: boolean } = {}) {
  const requester = await frank();
  const status = overrides.status ?? "PENDING_APPROVAL";
  const refund = await prisma.refund.create({
    data: {
      paymentId: overrides.paymentId ?? `pay_UNIT${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      customerName: "Unit Test Customer (TEST)",
      customerEmail: "unit.customer@example.com",
      cardLast4: "4242",
      amountCents: overrides.amountCents ?? 4999,
      currency: "USD",
      reason: "Unit test refund",
      status,
      requestedById: requester.id,
      issuedAt: status === "ISSUED" ? new Date() : null,
    },
  });
  const request =
    overrides.withRequest === false
      ? null
      : await prisma.approvalRequest.create({
          data: {
            entityType: "refunds.refund",
            entityId: refund.id,
            action: "refunds.issue",
            payload: JSON.stringify({ paymentId: refund.paymentId, amountCents: refund.amountCents, currency: refund.currency }),
            requestedById: requester.id,
            requestNote: "Unit test refund",
            status: status === "ISSUED" ? "CONFIRMED" : status === "RETURNED" ? "RETURNED" : "PENDING",
          },
        });
  return { refund, request };
}
