import { expect } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { asArray, asRecord, asString, json, login, type Session } from "./api";
import { dbUser, prisma } from "./db";

/** Case fields the suite relies on, as returned by the API (SPEC.md §9 names). */
export interface ApiCase {
  id: string;
  status: string;
  assignedToId: string | null;
  raw: Record<string, unknown>;
}

export const FINAL_STATUSES = ["APPROVED", "REJECTED"] as const;

export function toApiCase(value: unknown): ApiCase {
  const raw = asRecord(value, "case");
  const assignedToId = raw.assignedToId;
  return {
    id: asString(raw.id, "case.id"),
    status: asString(raw.status, "case.status"),
    assignedToId: typeof assignedToId === "string" ? assignedToId : null,
    raw,
  };
}

export async function listCases(session: Session): Promise<ApiCase[]> {
  const response = await session.api.get("/api/kyc/cases");
  expect(response.status(), `GET /api/kyc/cases as ${session.key}`).toBe(200);
  return asArray(await json(response), "case list").map(toApiCase);
}

export async function getCase(session: Session, id: string): Promise<APIResponse> {
  return session.api.get(`/api/kyc/cases/${id}`);
}

export async function assign(admin: Session, caseId: string, analystId: string): Promise<APIResponse> {
  return admin.api.post(`/api/kyc/cases/${caseId}/assign`, { data: { analystId } });
}

export async function startReview(analyst: Session, caseId: string): Promise<APIResponse> {
  return analyst.api.post(`/api/kyc/cases/${caseId}/start-review`);
}

export async function recommend(
  analyst: Session,
  caseId: string,
  recommendation: "approve" | "reject",
  note = "Recommendation submitted by the security suite",
): Promise<APIResponse> {
  return analyst.api.post(`/api/kyc/cases/${caseId}/recommend`, { data: { recommendation, note } });
}

export async function reveal(session: Session, caseId: string, field: string, reason: string): Promise<APIResponse> {
  return session.api.post(`/api/kyc/cases/${caseId}/reveal`, { data: { field, reason } });
}

export async function decide(
  session: Session,
  requestId: string,
  decision: "confirm" | "return",
  note: string | undefined = "Decision recorded by the security suite",
): Promise<APIResponse> {
  return session.api.post(`/api/approvals/${requestId}/decide`, { data: note === undefined ? { decision } : { decision, note } });
}

/**
 * Case discovery is done straight from the database: the seed is deterministic but tests
 * mutate state, so every call re-reads current state instead of caching.
 */
async function findCaseWhere(where: { status?: string; assignedToId?: string | null; notStatusIn?: string[] }): Promise<string> {
  const found = await prisma.kycCase.findFirst({
    where: {
      ...(where.status ? { status: where.status } : {}),
      ...(where.assignedToId !== undefined ? { assignedToId: where.assignedToId } : {}),
      ...(where.notStatusIn ? { status: { notIn: where.notStatusIn } } : {}),
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!found) throw new Error(`No KYC case matches ${JSON.stringify(where)}; seed data may be exhausted`);
  return found.id;
}

/** Any case currently assigned to the given analyst (state irrelevant). */
export async function anyCaseAssignedTo(analyst: "alice" | "bob"): Promise<string> {
  const user = await dbUser(analyst);
  return findCaseWhere({ assignedToId: user.id });
}

/** A `NEW` case that admin may still assign (unassigned first, else any `NEW` case). */
export async function newCaseForAssignment(): Promise<string> {
  try {
    return await findCaseWhere({ status: "NEW", assignedToId: null });
  } catch {
    return findCaseWhere({ status: "NEW" });
  }
}

/** Puts a case into `NEW` + assigned to `analyst`, driving the app through the admin API. */
export async function newCaseAssignedTo(analyst: "alice" | "bob"): Promise<string> {
  const analystUser = await dbUser(analyst);
  const existing = await prisma.kycCase.findFirst({
    where: { status: "NEW", assignedToId: analystUser.id },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const caseId = await newCaseForAssignment();
  const admin = await login("dan");
  try {
    const response = await assign(admin, caseId, analystUser.id);
    expect(response.status(), `admin assigns ${caseId} to ${analyst}`).toBe(200);
  } finally {
    await admin.api.dispose();
  }
  return caseId;
}

/** Puts a case into `IN_REVIEW` for `analyst` via the analyst API. */
export async function inReviewCaseFor(analyst: "alice" | "bob"): Promise<string> {
  const analystUser = await dbUser(analyst);
  const existing = await prisma.kycCase.findFirst({
    where: { status: "IN_REVIEW", assignedToId: analystUser.id },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const caseId = await newCaseAssignedTo(analyst);
  const session = await login(analyst);
  try {
    const response = await startReview(session, caseId);
    expect(response.status(), `${analyst} starts review on ${caseId}`).toBe(200);
  } finally {
    await session.api.dispose();
  }
  return caseId;
}

export interface PendingApproval {
  caseId: string;
  requestId: string;
}

/**
 * A `PENDING_APPROVAL` case with its `PENDING` approval request, recommended by `analyst`.
 * Reuses an existing one unless `fresh` is set (tests that decide a request must ask for a
 * fresh one so they never race over the same request).
 */
export async function pendingApprovalCaseFor(
  analyst: "alice" | "bob",
  options: { fresh?: boolean; recommendation?: "approve" | "reject" } = {},
): Promise<PendingApproval> {
  const analystUser = await dbUser(analyst);
  if (!options.fresh) {
    const existing = await prisma.approvalRequest.findFirst({
      where: { status: "PENDING", requestedById: analystUser.id },
      orderBy: { requestedAt: "asc" },
      select: { id: true, entityId: true },
    });
    if (existing) return { caseId: existing.entityId, requestId: existing.id };
  }
  const recommendation = options.recommendation ?? "approve";
  const caseId = await inReviewCaseFor(analyst);
  const session = await login(analyst);
  try {
    const response = await recommend(session, caseId, recommendation);
    expect(response.status(), `${analyst} recommends on ${caseId}`).toBe(200);
  } finally {
    await session.api.dispose();
  }
  const request = await prisma.approvalRequest.findFirstOrThrow({
    where: { entityId: caseId, status: "PENDING" },
    orderBy: { requestedAt: "desc" },
    select: { id: true },
  });
  return { caseId, requestId: request.id };
}
