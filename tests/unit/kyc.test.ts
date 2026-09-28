import { beforeAll, describe, expect, it } from "vitest";
import { assignCase, getCase, listCases, recommend, startReview } from "@/apps/kyc/cases";
import { visibleWhere } from "@/apps/kyc/visibleWhere";
import { loadApps } from "@/platform/apps";
import { prisma } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { alice, bob, carol, createCase, dan } from "./helpers";

describe("KYC record-level access", () => {
  it("visibleWhere scopes analysts to their own cases and nobody else", async () => {
    const analyst = await alice();
    expect(visibleWhere(analyst)).toEqual({ assignedToId: analyst.id });
    expect(visibleWhere(await carol())).toEqual({});
    expect(visibleWhere(await dan())).toEqual({});
  });

  it("listCases returns only the analyst's cases, sorted by risk desc", async () => {
    const analyst = await alice();
    const cases = await listCases(analyst);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((c) => c.assignedToId === analyst.id)).toBe(true);
    for (let i = 1; i < cases.length; i++) expect(cases[i - 1].riskScore).toBeGreaterThanOrEqual(cases[i].riskScore);
    expect(Array.isArray(cases[0].riskFlags)).toBe(true);
  });

  it("filters by status and risk band", async () => {
    const approver = await carol();
    const filtered = await listCases(approver, { status: "NEW", minRisk: 50 });
    expect(filtered.every((c) => c.status === "NEW" && c.riskScore >= 50)).toBe(true);
  });

  it("getCase throws NotFoundError (404, not 403) for a case assigned to someone else", async () => {
    const other = await bob();
    const kycCase = await createCase({ assignedToId: other.id });
    await expect(getCase(await alice(), kycCase.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startReview(await alice(), kycCase.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getCase(await carol(), kycCase.id)).id).toBe(kycCase.id);
  });
});

describe("KYC workflow", () => {
  beforeAll(() => loadApps());

  it("admin assigns NEW/IN_REVIEW cases to analysts only", async () => {
    const admin = await dan();
    const analyst = await bob();
    const kycCase = await createCase();
    const assigned = await assignCase(admin, kycCase.id, analyst.id);
    expect(assigned.assignedToId).toBe(analyst.id);
    await expect(assignCase(admin, kycCase.id, admin.id)).rejects.toBeInstanceOf(ValidationError);
    const done = await createCase({ status: "APPROVED" });
    await expect(assignCase(admin, done.id, analyst.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.auditEvent.count({ where: { action: "kyc.case.assigned", entityId: kycCase.id } })).toBe(1);
  });

  it("NEW → IN_REVIEW → PENDING_APPROVAL with an approval request; final status is never set by the analyst", async () => {
    const analyst = await alice();
    const kycCase = await createCase({ assignedToId: analyst.id });

    await expect(recommend(analyst, kycCase.id, "approve", "too early")).rejects.toBeInstanceOf(ValidationError);
    expect((await startReview(analyst, kycCase.id)).status).toBe("IN_REVIEW");
    await expect(startReview(analyst, kycCase.id)).rejects.toBeInstanceOf(ValidationError);

    const pending = await recommend(analyst, kycCase.id, "approve", "documents verified");
    expect(pending.status).toBe("PENDING_APPROVAL");

    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "kyc.case", entityId: kycCase.id } });
    expect(request.status).toBe("PENDING");
    expect(request.requestedById).toBe(analyst.id);
    expect(JSON.parse(request.payload)).toEqual({ recommendation: "approve" });

    const actions = (await prisma.auditEvent.findMany({ where: { entityId: kycCase.id }, orderBy: { timestamp: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["kyc.case.review_started", "kyc.case.recommended"]);
  });
});
