import { describe, expect, it } from "vitest";
import { DECIDE_PERMISSIONS, ROLE_PERMISSIONS, ROLES, can, isRole } from "@/platform/permissions";

describe("permissions matrix (SPEC section 8)", () => {
  it("matches the spec exactly", () => {
    expect(ROLE_PERMISSIONS).toEqual({
      analyst: ["kyc.case.read", "kyc.case.work", "pii.reveal", "disputes.dispute.read", "disputes.dispute.work"],
      approver: ["kyc.case.read", "kyc.case.decide", "pii.reveal", "refunds.refund.read", "refunds.refund.decide", "disputes.dispute.read", "disputes.dispute.decide"],
      admin: ["kyc.case.read", "kyc.case.assign", "audit.read", "refunds.refund.read", "disputes.dispute.read", "disputes.dispute.assign"],
      auditor: ["kyc.case.read", "audit.read", "refunds.refund.read", "disputes.dispute.read"],
      support_agent: ["refunds.refund.read", "refunds.refund.request"],
    });
    expect(DECIDE_PERMISSIONS).toEqual(["kyc.case.decide", "refunds.refund.decide", "disputes.dispute.decide"]);
  });

  it("can() answers from the matrix only", () => {
    expect(can({ role: "analyst" }, "kyc.case.work")).toBe(true);
    expect(can({ role: "analyst" }, "kyc.case.decide")).toBe(false);
    expect(can({ role: "approver" }, "kyc.case.work")).toBe(false);
    expect(can({ role: "admin" }, "pii.reveal")).toBe(false);
    expect(can({ role: "auditor" }, "audit.read")).toBe(true);
    expect(can({ role: "support_agent" }, "refunds.refund.request")).toBe(true);
    expect(can({ role: "support_agent" }, "refunds.refund.decide")).toBe(false);
    expect(can({ role: "support_agent" }, "pii.reveal")).toBe(false);
    expect(can({ role: "support_agent" }, "kyc.case.read")).toBe(false);
    expect(can({ role: "admin" }, "refunds.refund.decide")).toBe(false);
    expect(can({ role: "analyst" }, "refunds.refund.read")).toBe(false);
  });

  it("denies when there is no user", () => {
    expect(can(null, "kyc.case.read")).toBe(false);
    expect(can(undefined, "kyc.case.read")).toBe(false);
  });

  it("recognises only the five roles", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(ROLES).toEqual(["analyst", "approver", "admin", "auditor", "support_agent"]);
    expect(isRole("superuser")).toBe(false);
  });
});
