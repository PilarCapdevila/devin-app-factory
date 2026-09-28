import { test, expect } from "@playwright/test";
import { decideApproval } from "../../src/platform/approvals";
import { dispose, login } from "./helpers/api";
import { decide, pendingApprovalCaseFor } from "./helpers/cases";
import { dbApprovalRequest, dbCase, dbUser, prisma } from "./helpers/db";
import { expectRejectsLike, FORBIDDEN } from "./helpers/errors";

/** M6 is enforced inside `decideApproval`; SECURITY.md asks for it to be tested directly. */
test.describe("M6 Maker-checker (decideApproval)", () => {
  test("M6: the requester cannot confirm their own request", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true });
    const alice = await dbUser("alice");
    await expectRejectsLike(
      decideApproval({ requestId, deciderId: alice.id, decision: "confirm", note: "Self-confirmation attempt" }),
      FORBIDDEN,
    );
    const request = await dbApprovalRequest(requestId);
    expect(request.status).toBe("PENDING");
    expect(request.decidedById).toBeNull();
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
  });

  test("M6: the requester cannot return their own request", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true });
    const alice = await dbUser("alice");
    await expectRejectsLike(
      decideApproval({ requestId, deciderId: alice.id, decision: "return", note: "Self-return attempt" }),
      FORBIDDEN,
    );
    expect((await dbApprovalRequest(requestId)).status).toBe("PENDING");
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
  });

  test("M6: the requester cannot decide even when they hold the decide permission", async () => {
    // Make the approver the requester of a pending request, so role alone would allow deciding.
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true });
    const carol = await dbUser("carol");
    await prisma.approvalRequest.update({ where: { id: requestId }, data: { requestedById: carol.id } });

    for (const decision of ["confirm", "return"] as const) {
      await expectRejectsLike(
        decideApproval({ requestId, deciderId: carol.id, decision, note: "Approver deciding their own request" }),
        FORBIDDEN,
      );
    }
    const request = await dbApprovalRequest(requestId);
    expect(request.status).toBe("PENDING");
    expect(request.decidedById).toBeNull();
    expect((await dbCase(caseId)).status).toBe("PENDING_APPROVAL");
  });

  test("M6: a different user with the decide permission can decide the same request", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true, recommendation: "reject" });
    const carol = await dbUser("carol");
    await decideApproval({ requestId, deciderId: carol.id, decision: "confirm", note: "Confirmed by a separate checker" });
    const request = await dbApprovalRequest(requestId);
    expect(request.status).toBe("CONFIRMED");
    expect(request.decidedById).toBe(carol.id);
    expect(request.requestedById).not.toBe(carol.id);
    expect((await dbCase(caseId)).status).toBe("REJECTED");
  });

  test("M6: the requester is also refused through the API", async () => {
    const { requestId } = await pendingApprovalCaseFor("alice");
    const alice = await login("alice");
    const response = await decide(alice, requestId, "confirm");
    expect(response.status()).toBe(403);
    expect((await dbApprovalRequest(requestId)).status).toBe("PENDING");
    await dispose(alice);
  });
});
