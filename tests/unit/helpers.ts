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
