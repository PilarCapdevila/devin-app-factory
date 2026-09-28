import { test, expect } from "@playwright/test";
import { asArray, dispose, idsOf, json, login } from "./helpers/api";
import {
  anyCaseAssignedTo,
  assign,
  getCase,
  inReviewCaseFor,
  listCases,
  newCaseAssignedTo,
  recommend,
  reveal,
  startReview,
} from "./helpers/cases";
import { dbCase, dbUser, prisma } from "./helpers/db";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

test.describe("M4 Record-level access", () => {
  test("M4: analyst list contains only cases assigned to them and none assigned to someone else", async () => {
    const alice = await login("alice");
    const aliceId = (await dbUser("alice")).id;
    const bobId = (await dbUser("bob")).id;
    const visible = await listCases(alice);
    expect(visible.length).toBeGreaterThan(0);
    for (const c of visible) expect(c.assignedToId, `case ${c.id} in alice's list`).toBe(aliceId);

    const bobsCases = await prisma.kycCase.findMany({ where: { assignedToId: bobId }, select: { id: true } });
    const unassigned = await prisma.kycCase.findMany({ where: { assignedToId: null }, select: { id: true } });
    expect(bobsCases.length, "seed must give bob some cases").toBeGreaterThan(0);
    const ids = new Set(visible.map((c) => c.id));
    for (const { id } of [...bobsCases, ...unassigned]) expect(ids.has(id), `case ${id} must be absent from alice's list`).toBe(false);
    await dispose(alice);
  });

  test("M4: analyst gets 404 for a case assigned to someone else", async () => {
    const alice = await login("alice");
    const bobsCase = await anyCaseAssignedTo("bob");
    const response = await getCase(alice, bobsCase);
    expect(response.status()).toBe(404);
    await dispose(alice);
  });

  test("M4: analyst gets 404 for an unassigned case", async () => {
    const unassigned = await prisma.kycCase.findFirst({ where: { assignedToId: null }, select: { id: true } });
    test.skip(!unassigned, "seed has no unassigned case left");
    if (!unassigned) return;
    const alice = await login("alice");
    const response = await getCase(alice, unassigned.id);
    expect(response.status()).toBe(404);
    await dispose(alice);
  });

  test("M4: an out-of-scope case is indistinguishable from a non-existent one (no ID probing)", async () => {
    const alice = await login("alice");
    const outOfScope = await getCase(alice, await anyCaseAssignedTo("bob"));
    const missing = await getCase(alice, MISSING_ID);
    expect(outOfScope.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(await outOfScope.text()).toBe(await missing.text());
    await dispose(alice);
  });

  test("M4: the same case is visible to roles that read all cases (it does exist)", async () => {
    const bobsCase = await anyCaseAssignedTo("bob");
    for (const key of ["carol", "dan", "erin"] as const) {
      const session = await login(key);
      const response = await getCase(session, bobsCase);
      expect(response.status(), `${key} reads bob's case`).toBe(200);
      expect(idsOf(asArray(await json(await session.api.get("/api/kyc/cases")))), `${key} list includes bob's case`).toContain(bobsCase);
      await dispose(session);
    }
  });

  test("M4: analyst cannot start review on someone else's case (404, state unchanged)", async () => {
    const alice = await login("alice");
    const bobsNewCase = await newCaseAssignedTo("bob");
    const response = await startReview(alice, bobsNewCase);
    expect(response.status()).toBe(404);
    expect((await dbCase(bobsNewCase)).status).toBe("NEW");
    await dispose(alice);
  });

  test("M4: analyst cannot recommend on someone else's case (404, no approval request created)", async () => {
    const alice = await login("alice");
    const bobsCase = await inReviewCaseFor("bob");
    const requestsBefore = await prisma.approvalRequest.count({ where: { entityId: bobsCase } });
    const response = await recommend(alice, bobsCase, "approve");
    expect(response.status()).toBe(404);
    expect((await dbCase(bobsCase)).status).toBe("IN_REVIEW");
    expect(await prisma.approvalRequest.count({ where: { entityId: bobsCase } })).toBe(requestsBefore);
    await dispose(alice);
  });

  test("M4: analyst cannot reveal PII on someone else's case (404)", async () => {
    const alice = await login("alice");
    const bobsCase = await anyCaseAssignedTo("bob");
    for (const field of ["dateOfBirth", "nationalId", "address"]) {
      const response = await reveal(alice, bobsCase, field, "Legitimate-looking reason text");
      expect(response.status(), `reveal ${field}`).toBe(404);
      expect(await response.text()).not.toContain((await dbCase(bobsCase)).nationalId);
    }
    await dispose(alice);
  });

  test("M4: reassignment moves visibility from one analyst to the other", async () => {
    const alice = await login("alice");
    const bob = await login("bob");
    const dan = await login("dan");
    const aliceId = (await dbUser("alice")).id;
    const caseId = await newCaseAssignedTo("bob");

    expect((await getCase(bob, caseId)).status()).toBe(200);
    expect((await getCase(alice, caseId)).status()).toBe(404);

    const reassign = await assign(dan, caseId, aliceId);
    expect(reassign.status()).toBe(200);

    expect((await getCase(alice, caseId)).status()).toBe(200);
    expect((await getCase(bob, caseId)).status()).toBe(404);
    expect(idsOf(asArray(await json(await bob.api.get("/api/kyc/cases"))))).not.toContain(caseId);
    await dispose(alice, bob, dan);
  });
});
