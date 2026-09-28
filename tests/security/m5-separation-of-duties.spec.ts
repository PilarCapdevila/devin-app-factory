import { test, expect } from "@playwright/test";
import { decideApproval } from "./helpers/platform";
import { dispose, login } from "./helpers/api";
import { anyCaseAssignedTo, decide, pendingApprovalCaseFor, reveal } from "./helpers/cases";
import { dbApprovalRequest, dbCase, dbUser } from "./helpers/db";
import { expectRejectsLike, FORBIDDEN } from "./helpers/errors";
import { PII_FIELDS } from "./helpers/pii";

test.describe("M5 Separation of duties", () => {
  test("M5: admin cannot decide an approval request (403, request stays PENDING)", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice");
    const dan = await login("dan");
    for (const decision of ["confirm", "return"] as const) {
      const response = await decide(dan, requestId, decision);
      expect(response.status(), `admin ${decision}`).toBe(403);
    }
    expect((await dbApprovalRequest(requestId)).status).toBe("PENDING");
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
    await dispose(dan);
  });

  test("M5: admin cannot reveal PII on any case (403)", async () => {
    const dan = await login("dan");
    const caseId = await anyCaseAssignedTo("alice");
    const raw = await dbCase(caseId);
    for (const field of PII_FIELDS) {
      const response = await reveal(dan, caseId, field, "Admin attempting to reveal a field");
      expect(response.status(), `admin reveals ${field}`).toBe(403);
      expect(await response.text()).not.toContain(raw.nationalId);
      expect(await response.text()).not.toContain(raw.address);
    }
    await dispose(dan);
  });

  test("M5: auditor and analyst cannot decide an approval request (403)", async () => {
    const { requestId } = await pendingApprovalCaseFor("alice");
    for (const key of ["erin", "bob"] as const) {
      const session = await login(key);
      const response = await decide(session, requestId, "confirm");
      expect(response.status(), `${key} decides`).toBe(403);
      await dispose(session);
    }
    expect((await dbApprovalRequest(requestId)).status).toBe("PENDING");
  });

  test("M5: auditor cannot reveal PII (403)", async () => {
    const erin = await login("erin");
    const response = await reveal(erin, await anyCaseAssignedTo("alice"), "nationalId", "Auditor attempting a reveal");
    expect(response.status()).toBe(403);
    await dispose(erin);
  });

  test("M5: only a holder of the action's decidePermission (approver) can decide", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true, recommendation: "approve" });
    const carol = await login("carol");
    const response = await decide(carol, requestId, "confirm", "Confirmed by approver in security suite");
    expect(response.status(), await response.text()).toBe(200);
    const request = await dbApprovalRequest(requestId);
    expect(request.status).toBe("CONFIRMED");
    expect(request.decidedById).toBe((await dbUser("carol")).id);
    expect((await dbCase(caseId)).status).toBe("APPROVED");
    await dispose(carol);
  });

  test("M5: decideApproval rejects deciders without the action's decidePermission (admin, auditor, analyst)", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true });
    for (const key of ["dan", "erin", "bob"] as const) {
      const decider = await dbUser(key);
      await expectRejectsLike(
        decideApproval({ requestId, deciderId: decider.id, decision: "confirm", note: "Attempt without decide permission" }),
        FORBIDDEN,
      );
      expect((await dbApprovalRequest(requestId)).status, `after ${key}'s attempt`).toBe("PENDING");
    }
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
  });
});
