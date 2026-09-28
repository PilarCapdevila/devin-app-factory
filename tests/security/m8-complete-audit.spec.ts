import { test, expect } from "@playwright/test";
import { writeAuditEvent } from "../../src/platform/audit";
import { dispose, login, type Session } from "./helpers/api";
import { auditEvents, expectCompleteEvent, jsonText, lastEvent, type AuditRow } from "./helpers/audit";
import {
  anyCaseAssignedTo,
  assign,
  decide,
  getCase,
  inReviewCaseFor,
  newCaseAssignedTo,
  newCaseForAssignment,
  pendingApprovalCaseFor,
  recommend,
  reveal,
  startReview,
} from "./helpers/cases";
import { dbCase, dbUser, failingTransactionClient, prisma } from "./helpers/db";

async function newEventsFor(actorId: string, since: Date, entityId?: string): Promise<AuditRow[]> {
  return auditEvents({ since, actorId, entityId });
}

test.describe("M8 Complete audit: every state change is audited in the same transaction", () => {
  test("M8: assigning a case writes a complete audit event", async () => {
    const dan = await login("dan");
    const [danUser, alice] = [await dbUser("dan"), await dbUser("alice")];
    const caseId = await newCaseForAssignment();
    const since = new Date();
    expect((await assign(dan, caseId, alice.id)).status()).toBe(200);

    const event = lastEvent(await newEventsFor(danUser.id, since, caseId), "assign");
    expectCompleteEvent(event, { actorId: danUser.id, actorRole: "admin", entityId: caseId });
    expect(jsonText(event.after)).toContain(alice.id);
    await dispose(dan);
  });

  test("M8: starting a review writes a complete audit event with before/after state", async () => {
    const alice = await login("alice");
    const aliceUser = await dbUser("alice");
    const caseId = await newCaseAssignedTo("alice");
    const since = new Date();
    expect((await startReview(alice, caseId)).status()).toBe(200);

    const event = lastEvent(await newEventsFor(aliceUser.id, since, caseId), "start-review");
    expectCompleteEvent(event, { actorId: aliceUser.id, actorRole: "analyst", entityId: caseId });
    expect(jsonText(event.before)).toContain("NEW");
    expect(jsonText(event.after)).toContain("IN_REVIEW");
    await dispose(alice);
  });

  test("M8: submitting a recommendation writes audit events for the case and the approval request", async () => {
    const alice = await login("alice");
    const aliceUser = await dbUser("alice");
    const caseId = await inReviewCaseFor("alice");
    const since = new Date();
    expect((await recommend(alice, caseId, "approve", "Documents verified")).status()).toBe(200);

    const events = await newEventsFor(aliceUser.id, since);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) expectCompleteEvent(event, { actorId: aliceUser.id, actorRole: "analyst", entityId: event.entityId });
    const caseEvent = events.find((e) => e.entityId === caseId && jsonText(e.after).includes("PENDING_APPROVAL"));
    expect(caseEvent, "case transition to PENDING_APPROVAL is audited").toBeDefined();
    await dispose(alice);
  });

  test("M8: deciding a request writes a complete audit event with the decision note as reason", async () => {
    const { caseId, requestId } = await pendingApprovalCaseFor("alice", { fresh: true, recommendation: "approve" });
    const carol = await login("carol");
    const carolUser = await dbUser("carol");
    const since = new Date();
    const note = "Approved after checking the sanctions list";
    expect((await decide(carol, requestId, "confirm", note)).status()).toBe(200);

    const events = await newEventsFor(carolUser.id, since);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) expectCompleteEvent(event, { actorId: carolUser.id, actorRole: "approver", entityId: event.entityId });
    const touchesRequestOrCase = events.some((e) => e.entityId === requestId || e.entityId === caseId);
    expect(touchesRequestOrCase, "decision event references the request or the case").toBe(true);
    const withNote = events.some((e) => e.reason === note || jsonText(e.after).includes(note));
    expect(withNote, "decision note is recorded").toBe(true);
    await dispose(carol);
  });

  test("M8: a PII reveal is audited with actor, field and reason", async () => {
    const carol = await login("carol");
    const carolUser = await dbUser("carol");
    const caseId = await anyCaseAssignedTo("alice");
    const since = new Date();
    const reason = "Verifying identity document number";
    expect((await reveal(carol, caseId, "nationalId", reason)).status()).toBe(200);

    const event = lastEvent(await newEventsFor(carolUser.id, since, caseId), "reveal");
    expectCompleteEvent(event, { actorId: carolUser.id, actorRole: "approver", entityId: caseId });
    expect(event.reason).toBe(reason);
    expect(`${event.action} ${jsonText(event.after)}`).toMatch(/nationalId|reveal/i);
    await dispose(carol);
  });

  test("M8: a 403 for a logged-in user is audited as access.denied", async () => {
    const erin = await login("erin");
    const erinUser = await dbUser("erin");
    const caseId = await anyCaseAssignedTo("alice");
    const since = new Date();
    expect((await reveal(erin, caseId, "nationalId", "Auditor should be denied")).status()).toBe(403);

    const denied = lastEvent(await auditEvents({ since, actorId: erinUser.id, action: "access.denied" }), "403 denial");
    expect(denied.actorRole).toBe("auditor");
    expect(denied.timestamp).toBeInstanceOf(Date);
    await dispose(erin);
  });

  test("M8: a 404 for an out-of-scope record is audited as access.denied", async () => {
    const alice = await login("alice");
    const aliceUser = await dbUser("alice");
    const bobsCase = await anyCaseAssignedTo("bob");
    const since = new Date();
    expect((await getCase(alice, bobsCase)).status()).toBe(404);

    const denied = lastEvent(await auditEvents({ since, actorId: aliceUser.id, action: "access.denied" }), "404 denial");
    expect(denied.actorRole).toBe("analyst");
    await dispose(alice);
  });

  test("M8: denied requests are audited across roles and routes", async () => {
    const { requestId } = await pendingApprovalCaseFor("alice");
    const caseId = await anyCaseAssignedTo("alice");
    const attempts = [
      { key: "dan", run: (s: Session) => decide(s, requestId, "confirm") },
      { key: "bob", run: (s: Session) => s.api.get("/api/audit") },
      { key: "carol", run: (s: Session) => startReview(s, caseId) },
      { key: "erin", run: (s: Session) => assign(s, caseId, "irrelevant") },
    ] as const;
    for (const attempt of attempts) {
      const session = await login(attempt.key);
      const user = await dbUser(attempt.key);
      const since = new Date();
      expect((await attempt.run(session)).status(), `${attempt.key} denied`).toBe(403);
      const denied = await auditEvents({ since, actorId: user.id, action: "access.denied" });
      expect(denied.length, `${attempt.key}'s denial is audited`).toBeGreaterThanOrEqual(1);
      await dispose(session);
    }
  });
});

test.describe("M8 writeAuditEvent transactional behaviour", () => {
  const marker = () => `security-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  test("M8: writeAuditEvent writes through the caller's transaction (rolled back with it)", async () => {
    const alice = await dbUser("alice");
    const caseId = await anyCaseAssignedTo("alice");
    const reason = marker();
    await expect(
      prisma.$transaction(async (tx) => {
        await writeAuditEvent(tx, {
          actorId: alice.id,
          actorRole: alice.role,
          action: "security.suite.probe",
          entityType: "KycCase",
          entityId: caseId,
          before: { status: "NEW" },
          after: { status: "NEW" },
          reason,
        });
        throw new Error("abort transaction after audit write");
      }),
    ).rejects.toThrow("abort transaction after audit write");

    const leaked = await prisma.auditEvent.count({ where: { reason } });
    expect(leaked, "audit row must not survive a rolled-back transaction").toBe(0);
  });

  test("M8: writeAuditEvent commits together with the state change", async () => {
    const alice = await dbUser("alice");
    const caseId = await anyCaseAssignedTo("alice");
    const reason = marker();
    const current = await dbCase(caseId);
    await prisma.$transaction(async (tx) => {
      await tx.kycCase.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
      await writeAuditEvent(tx, {
        actorId: alice.id,
        actorRole: alice.role,
        action: "security.suite.probe",
        entityType: "KycCase",
        entityId: caseId,
        before: { status: current.status },
        after: { status: current.status },
        reason,
      });
    });
    const events = await prisma.auditEvent.findMany({ where: { reason } });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.actorId).toBe(alice.id);
    expect(event?.actorRole).toBe(alice.role);
    expect(event?.entityId).toBe(caseId);
    expect(event?.timestamp.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  test("M8: if the audit write fails the state change is rolled back", async () => {
    const alice = await dbUser("alice");
    const caseId = await newCaseAssignedTo("alice");
    const before = await dbCase(caseId);
    expect(before.status).toBe("NEW");

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.kycCase.update({ where: { id: caseId }, data: { status: "IN_REVIEW" } });
        await writeAuditEvent(failingTransactionClient(), {
          actorId: alice.id,
          actorRole: alice.role,
          action: "kyc.case.start_review",
          entityType: "KycCase",
          entityId: caseId,
          before: { status: "NEW" },
          after: { status: "IN_REVIEW" },
          reason: marker(),
        });
      }),
    ).rejects.toThrow();

    expect((await dbCase(caseId)).status, "state change must be rolled back when the audit write fails").toBe("NEW");
  });
});
