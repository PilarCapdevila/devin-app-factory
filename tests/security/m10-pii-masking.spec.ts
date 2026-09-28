import { test, expect } from "@playwright/test";
import { asArray, asRecord, dispose, json, login } from "./helpers/api";
import { anyCaseAssignedTo, getCase, listCases, pendingApprovalCaseFor, reveal } from "./helpers/cases";
import { dbCase, dbCases, dbUser } from "./helpers/db";
import { auditEvents } from "./helpers/audit";
import { PII_FIELDS, expectMaskedCase, expectNoRawPii, rawPiiStrings } from "./helpers/pii";
import { ROLES, USER_FOR_ROLE } from "./helpers/users";

const VALID_REASON = "Identity verification for onboarding"; // > 10 characters

test.describe("M10 PII masked by default", () => {
  for (const role of ROLES) {
    test(`M10: ${role} case list has every PII field masked`, async () => {
      const session = await login(USER_FOR_ROLE[role]);
      const cases = await listCases(session);
      expect(cases.length, `${role} sees at least one case`).toBeGreaterThan(0);
      for (const apiCase of cases) {
        expectMaskedCase(apiCase.raw, await dbCase(apiCase.id));
      }
      expectNoRawPii(cases.map((c) => c.raw), await dbCases());
      await dispose(session);
    });

    test(`M10: ${role} case detail has every PII field masked`, async () => {
      const session = await login(USER_FOR_ROLE[role]);
      const caseId = await anyCaseAssignedTo("alice");
      const response = await getCase(session, caseId);
      expect(response.status()).toBe(200);
      const body = asRecord(await json(response), "case detail");
      const detail = "id" in body ? body : asRecord(body.case ?? body.data, "case detail payload");
      expectMaskedCase(detail, await dbCase(caseId));
      expectNoRawPii(body, [await dbCase(caseId)]);
      await dispose(session);
    });
  }

  test("M10: the approvals inbox contains no raw PII", async () => {
    await pendingApprovalCaseFor("alice");
    const carol = await login("carol");
    const response = await carol.api.get("/api/approvals");
    expect(response.status()).toBe(200);
    const body = await json(response);
    expect(asArray(body, "inbox").length).toBeGreaterThan(0);
    expectNoRawPii(body, await dbCases());
    await dispose(carol);
  });

  test("M10: the audit log API contains no raw PII (including before/after snapshots)", async () => {
    const carol = await login("carol");
    const caseId = await anyCaseAssignedTo("alice");
    expect((await reveal(carol, caseId, "nationalId", VALID_REASON)).status()).toBe(200);
    for (const key of ["dan", "erin"] as const) {
      const session = await login(key);
      const response = await session.api.get("/api/audit");
      expect(response.status(), `${key} reads the audit log`).toBe(200);
      expectNoRawPii(await json(response), await dbCases());
      const filtered = await session.api.get("/api/audit", { params: { entityId: caseId } });
      expect(filtered.status()).toBe(200);
      expectNoRawPii(await json(filtered), await dbCases());
      await dispose(session);
    }
    await dispose(carol);
  });

  test("M10: error responses (400/403/404) contain no raw PII", async () => {
    const alice = await login("alice");
    const dan = await login("dan");
    const bobsCase = await anyCaseAssignedTo("bob");
    const alicesCase = await anyCaseAssignedTo("alice");
    const responses = [
      await getCase(alice, bobsCase),
      await reveal(alice, alicesCase, "nationalId", "short"),
      await reveal(dan, alicesCase, "nationalId", VALID_REASON),
    ];
    expect(responses.map((r) => r.status())).toEqual([404, 400, 403]);
    for (const response of responses) expectNoRawPii(await json(response), await dbCases());
    await dispose(alice, dan);
  });
});

test.describe("M10 Reveal-with-reason", () => {
  for (const field of PII_FIELDS) {
    test(`M10: approver reveals ${field} with a reason and receives only that field`, async () => {
      const carol = await login("carol");
      const caseId = await anyCaseAssignedTo("alice");
      const raw = await dbCase(caseId);
      const response = await reveal(carol, caseId, field, VALID_REASON);
      expect(response.status(), await response.text()).toBe(200);
      const body = asRecord(await json(response), "reveal response");
      expect(Object.keys(body).sort()).toEqual(["field", "value"]);
      expect(body.field).toBe(field);
      const value = body.value;
      expect(typeof value).toBe("string");
      expect(rawPiiStrings(raw), `revealed ${field} equals the stored value`).toContain(String(value));

      // Only that one field is revealed: the other PII values must not appear anywhere.
      const others = rawPiiStrings({
        dateOfBirth: field === "dateOfBirth" ? "" : raw.dateOfBirth,
        nationalId: field === "nationalId" ? "" : raw.nationalId,
        address: field === "address" ? "" : raw.address,
      });
      for (const other of others) expect(JSON.stringify(body)).not.toContain(other);
      await dispose(carol);
    });
  }

  test("M10: analyst may reveal on an assigned case", async () => {
    const alice = await login("alice");
    const caseId = await anyCaseAssignedTo("alice");
    const raw = await dbCase(caseId);
    const response = await reveal(alice, caseId, "nationalId", VALID_REASON);
    expect(response.status(), await response.text()).toBe(200);
    expect(asRecord(await json(response)).value).toBe(raw.nationalId);
    await dispose(alice);
  });

  test("M10: analyst gets 404 revealing on a case assigned to someone else", async () => {
    const alice = await login("alice");
    const response = await reveal(alice, await anyCaseAssignedTo("bob"), "nationalId", VALID_REASON);
    expect(response.status()).toBe(404);
    await dispose(alice);
  });

  test("M10: admin and auditor cannot reveal (403)", async () => {
    const caseId = await anyCaseAssignedTo("alice");
    for (const key of ["dan", "erin"] as const) {
      const session = await login(key);
      const response = await reveal(session, caseId, "nationalId", VALID_REASON);
      expect(response.status(), `${key} reveal`).toBe(403);
      await dispose(session);
    }
  });

  test("M10: a reason shorter than 10 characters is rejected (400) and nothing is revealed", async () => {
    const carol = await login("carol");
    const caseId = await anyCaseAssignedTo("alice");
    const raw = await dbCase(caseId);
    for (const reason of ["", "short", "123456789", "         "]) {
      const response = await reveal(carol, caseId, "nationalId", reason);
      expect(response.status(), `reason=${JSON.stringify(reason)}`).toBe(400);
      expect(await response.text()).not.toContain(raw.nationalId);
    }
    const missingReason = await carol.api.post(`/api/kyc/cases/${caseId}/reveal`, { data: { field: "nationalId" } });
    expect(missingReason.status()).toBe(400);
    await dispose(carol);
  });

  test("M10: a reason of exactly 10 characters is accepted", async () => {
    const carol = await login("carol");
    const response = await reveal(carol, await anyCaseAssignedTo("alice"), "nationalId", "0123456789");
    expect(response.status(), await response.text()).toBe(200);
    await dispose(carol);
  });

  test("M10: only declared PII fields can be revealed (400 for anything else)", async () => {
    const carol = await login("carol");
    const caseId = await anyCaseAssignedTo("alice");
    for (const field of ["applicantName", "riskScore", "status", "assignedToId", "passwordHash", "*", ""]) {
      const response = await reveal(carol, caseId, field, VALID_REASON);
      expect(response.status(), `field=${JSON.stringify(field)}`).toBe(400);
    }
    await dispose(carol);
  });

  test("M10: reveal cannot return several fields at once", async () => {
    const carol = await login("carol");
    const caseId = await anyCaseAssignedTo("alice");
    const raw = await dbCase(caseId);
    const response = await carol.api.post(`/api/kyc/cases/${caseId}/reveal`, {
      data: { field: ["nationalId", "address"], reason: VALID_REASON },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain(raw.address);
    await dispose(carol);
  });

  test("M10: every reveal is audited with the actor and the reason", async () => {
    const carol = await login("carol");
    const carolUser = await dbUser("carol");
    const caseId = await anyCaseAssignedTo("alice");
    const reason = `Reveal audit check ${Date.now()}`;
    const since = new Date();
    expect((await reveal(carol, caseId, "address", reason)).status()).toBe(200);
    const events = await auditEvents({ since, actorId: carolUser.id, entityId: caseId });
    const revealEvent = events.find((e) => e.reason === reason);
    expect(revealEvent, "reveal audit event with the given reason").toBeDefined();
    expect(revealEvent?.actorRole).toBe("approver");
    expect(`${revealEvent?.action} ${JSON.stringify(revealEvent?.after ?? null)}`).toMatch(/address|reveal/i);
    await dispose(carol);
  });

  test("M10: a denied reveal (short reason) is not recorded as a successful reveal", async () => {
    const carol = await login("carol");
    const carolUser = await dbUser("carol");
    const caseId = await anyCaseAssignedTo("alice");
    const since = new Date();
    expect((await reveal(carol, caseId, "address", "short")).status()).toBe(400);
    const events = await auditEvents({ since, actorId: carolUser.id, entityId: caseId });
    expect(events.filter((e) => e.reason === "short")).toHaveLength(0);
    await dispose(carol);
  });
});
