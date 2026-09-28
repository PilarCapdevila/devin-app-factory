import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, ROLES, can, isRole } from "@/platform/permissions";

describe("permissions matrix (SPEC section 8)", () => {
  it("matches the spec exactly", () => {
    expect(ROLE_PERMISSIONS).toEqual({
      analyst: ["kyc.case.read", "kyc.case.work", "pii.reveal"],
      approver: ["kyc.case.read", "kyc.case.decide", "pii.reveal"],
      admin: ["kyc.case.read", "kyc.case.assign", "audit.read"],
      auditor: ["kyc.case.read", "audit.read"],
    });
  });

  it("can() answers from the matrix only", () => {
    expect(can({ role: "analyst" }, "kyc.case.work")).toBe(true);
    expect(can({ role: "analyst" }, "kyc.case.decide")).toBe(false);
    expect(can({ role: "approver" }, "kyc.case.work")).toBe(false);
    expect(can({ role: "admin" }, "pii.reveal")).toBe(false);
    expect(can({ role: "auditor" }, "audit.read")).toBe(true);
  });

  it("denies when there is no user", () => {
    expect(can(null, "kyc.case.read")).toBe(false);
    expect(can(undefined, "kyc.case.read")).toBe(false);
  });

  it("recognises only the four roles", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("superuser")).toBe(false);
  });
});
