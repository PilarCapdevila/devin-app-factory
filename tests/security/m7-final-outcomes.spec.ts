import { test, expect } from "@playwright/test";
import { decideApproval } from "../../src/platform/approvals";
import { dispose, login } from "./helpers/api";
import {
  FINAL_STATUSES,
  anyCaseAssignedTo,
  decide,
  inReviewCaseFor,
  newCaseAssignedTo,
  newCaseForAssignment,
  pendingApprovalCaseFor,
  recommend,
} from "./helpers/cases";
import { dbApprovalRequest, dbCase, dbUser } from "./helpers/db";
import { expectRejectsLike, VALIDATION } from "./helpers/errors";

test.describe("M7 Final outcomes only through approvals", () => {
  test("M7: a recommendation moves the case to PENDING_APPROVAL, never to a final status", async () => {
    const alice = await login("alice");
    const caseId = await inReviewCaseFor("alice");
    const response = await recommend(alice, caseId, "approve");
    expect(response.status()).toBe(200);
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
    await dispose(alice);
  });

  test("M7: no state-changing route accepts a status field that sets a final outcome", async () => {
    const dan = await login("dan");
    const alice = await login("alice");
    const aliceId = (await dbUser("alice")).id;

    const attempts: Array<{ name: string; caseId: string; run: () => Promise<number> }> = [];

    const toAssign = await newCaseForAssignment();
    attempts.push({
      name: "assign",
      caseId: toAssign,
      run: async () => (await dan.api.post(`/api/kyc/cases/${toAssign}/assign`, { data: { analystId: aliceId, status: "APPROVED" } })).status(),
    });

    const toStart = await newCaseAssignedTo("alice");
    attempts.push({
      name: "start-review",
      caseId: toStart,
      run: async () => (await alice.api.post(`/api/kyc/cases/${toStart}/start-review`, { data: { status: "APPROVED" } })).status(),
    });

    const toRecommend = await inReviewCaseFor("alice");
    attempts.push({
      name: "recommend",
      caseId: toRecommend,
      run: async () =>
        (
          await alice.api.post(`/api/kyc/cases/${toRecommend}/recommend`, {
            data: { recommendation: "approve", note: "Trying to force a final status", status: "APPROVED" },
          })
        ).status(),
    });

    const toReveal = await anyCaseAssignedTo("alice");
    attempts.push({
      name: "reveal",
      caseId: toReveal,
      run: async () =>
        (
          await alice.api.post(`/api/kyc/cases/${toReveal}/reveal`, {
            data: { field: "nationalId", reason: "Trying to force a final status", status: "REJECTED" },
          })
        ).status(),
    });

    for (const attempt of attempts) {
      const status = await attempt.run();
      expect([200, 400], `${attempt.name} either ignores or rejects the extra field`).toContain(status);
      const after = await dbCase(attempt.caseId);
      expect(FINAL_STATUSES, `${attempt.name} must not produce a final status`).not.toContain(after.status);
    }
    await dispose(dan, alice);
  });

  test("M7: a decision without a note is rejected by the API (400) and nothing changes", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice");
    const carol = await login("carol");
    for (const body of [{ decision: "confirm" }, { decision: "confirm", note: "" }, { decision: "return", note: "   " }]) {
      const response = await carol.api.post(`/api/approvals/${requestId}/decide`, { data: body });
      expect(response.status(), JSON.stringify(body)).toBe(400);
    }
    expect((await dbApprovalRequest(requestId)).status).toBe("PENDING");
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
    await dispose(carol);
  });

  test("M7: decideApproval itself requires a note", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true });
    const carol = await dbUser("carol");
    await expectRejectsLike(decideApproval({ requestId, deciderId: carol.id, decision: "confirm", note: "" }), VALIDATION);
    expect((await dbApprovalRequest(requestId)).status).toBe("PENDING");
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
  });

  test("M7: an invalid decision value is rejected (400)", async () => {
    const { requestId } = await pendingApprovalCaseFor("alice");
    const carol = await login("carol");
    const response = await carol.api.post(`/api/approvals/${requestId}/decide`, {
      data: { decision: "approve", note: "Not a valid decision keyword" },
    });
    expect(response.status()).toBe(400);
    expect((await dbApprovalRequest(requestId)).status).toBe("PENDING");
    await dispose(carol);
  });

  test("M7: confirming an approve recommendation yields APPROVED", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true, recommendation: "approve" });
    const carol = await login("carol");
    const response = await decide(carol, requestId, "confirm", "Approve recommendation confirmed");
    expect(response.status(), await response.text()).toBe(200);
    expect((await dbCase(caseId)).status).toBe("APPROVED");
    expect((await dbApprovalRequest(requestId)).status).toBe("CONFIRMED");
    await dispose(carol);
  });

  test("M7: confirming a reject recommendation yields REJECTED", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true, recommendation: "reject" });
    const carol = await login("carol");
    const response = await decide(carol, requestId, "confirm", "Reject recommendation confirmed");
    expect(response.status(), await response.text()).toBe(200);
    expect((await dbCase(caseId)).status).toBe("REJECTED");
    await dispose(carol);
  });

  test("M7: returning a request sends the case back to IN_REVIEW, not to a final status", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true });
    const carol = await login("carol");
    const response = await decide(carol, requestId, "return", "Please double-check the risk flags");
    expect(response.status(), await response.text()).toBe(200);
    expect((await dbCase(caseId)).status).toBe("IN_REVIEW");
    const request = await dbApprovalRequest(requestId);
    expect(request.status).toBe("RETURNED");
    expect(request.decisionNote).toBe("Please double-check the risk flags");
    await dispose(carol);
  });

  test("M7: a request that is no longer PENDING cannot be decided again", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true, recommendation: "approve" });
    const carol = await login("carol");
    expect((await decide(carol, requestId, "confirm", "First and only decision")).status()).toBe(200);

    const again = await decide(carol, requestId, "return", "Trying to flip a decided request");
    expect(again.status()).toBeGreaterThanOrEqual(400);
    expect(again.status()).toBeLessThan(500);
    expect((await dbCase(caseId)).status).toBe("APPROVED");
    expect((await dbApprovalRequest(requestId)).status).toBe("CONFIRMED");
    await dispose(carol);
  });

  test("M7: a final case cannot be re-opened by the analyst workflow routes", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true, recommendation: "approve" });
    const carol = await login("carol");
    expect((await decide(carol, requestId, "confirm", "Closing the case for good")).status()).toBe(200);

    const alice = await login("alice");
    const start = await alice.api.post(`/api/kyc/cases/${caseId}/start-review`);
    expect(start.status()).toBeGreaterThanOrEqual(400);
    const rec = await recommend(alice, caseId, "reject");
    expect(rec.status()).toBeGreaterThanOrEqual(400);
    expect((await dbCase(caseId)).status).toBe("APPROVED");
    await dispose(carol, alice);
  });
});
