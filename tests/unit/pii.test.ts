import { describe, expect, it } from "vitest";
import { MASK, PII_FIELD_NAMES, maskPii, maskValue, revealField } from "@/platform/pii";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { prisma } from "@/platform/db";
import { alice, bob, createCase, dan } from "./helpers";

describe("PII masking", () => {
  it("lists the global PII field names", () => {
    expect(PII_FIELD_NAMES).toEqual(["dateOfBirth", "nationalId", "address", "customerEmail", "customerAddress"]);
  });

  it("masks nationalId keeping the last 4 characters and everything else fully", () => {
    expect(maskValue("nationalId", "TEST-12345678")).toBe(`${MASK}5678`);
    expect(maskValue("dateOfBirth", "1990-01-01")).toBe(MASK);
    expect(maskValue("address", "1 Street")).toBe(MASK);
    expect(maskValue("address", null)).toBeNull();
  });

  it("masks recursively through arrays, nested objects and audit before/after snapshots", () => {
    const masked = maskPii({
      items: [{ nationalId: "AB123456", riskScore: 7 }],
      audit: { before: { address: "somewhere" }, after: null },
      untouched: "fine",
    });
    expect(masked).toEqual({
      items: [{ nationalId: `${MASK}3456`, riskScore: 7 }],
      audit: { before: { address: MASK }, after: null },
      untouched: "fine",
    });
  });
});

describe("revealField", () => {
  it("requires pii.reveal", async () => {
    const kycCase = await createCase();
    await expect(revealField({ user: await dan(), entityType: "kyc.case", entityId: kycCase.id, field: "nationalId", reason: "legitimate investigation" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects short reasons and unknown fields", async () => {
    const user = await alice();
    const kycCase = await createCase({ assignedToId: user.id });
    await expect(revealField({ user, entityType: "kyc.case", entityId: kycCase.id, field: "nationalId", reason: "short" })).rejects.toBeInstanceOf(ValidationError);
    await expect(revealField({ user, entityType: "kyc.case", entityId: kycCase.id, field: "applicantName", reason: "legitimate investigation" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns 404 for a record outside the analyst's scope and never reveals it", async () => {
    const owner = await bob();
    const kycCase = await createCase({ assignedToId: owner.id });
    await expect(revealField({ user: await alice(), entityType: "kyc.case", entityId: kycCase.id, field: "nationalId", reason: "legitimate investigation" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.auditEvent.count({ where: { action: "pii.reveal", entityId: kycCase.id } })).toBe(0);
  });

  it("reveals one value and writes a pii.reveal audit event with the reason", async () => {
    const user = await alice();
    const kycCase = await createCase({ assignedToId: user.id });
    const result = await revealField({ user, entityType: "kyc.case", entityId: kycCase.id, field: "nationalId", reason: "verifying identity document" });
    expect(result).toEqual({ field: "nationalId", value: "TEST-12345678" });
    const event = await prisma.auditEvent.findFirst({ where: { action: "pii.reveal", entityId: kycCase.id } });
    expect(event?.actorId).toBe(user.id);
    expect(event?.reason).toBe("verifying identity document");
    expect(event?.after).toContain('"nationalId"');
    expect(event?.after).not.toContain("12345678");
  });
});
