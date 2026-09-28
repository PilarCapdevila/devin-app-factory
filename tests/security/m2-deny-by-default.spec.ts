import { test, expect } from "@playwright/test";
import { dispose, json, login } from "./helpers/api";
import { anyCaseAssignedTo, pendingApprovalCaseFor } from "./helpers/cases";
import { dbUser } from "./helpers/db";
import { collectStrings } from "./helpers/pii";
import { MATRIX, PROTECTED_ROUTES, type RouteParams } from "./helpers/routes";
import { ROLES, USER_FOR_ROLE } from "./helpers/users";

/**
 * M2 is a property of `secureHandler` (a handler with no declared permission fails closed).
 * Treating the app as a black box, the observable guarantee is that *no* contract route ever
 * succeeds for a caller lacking its permission — regardless of body validity, HTTP method or
 * record state — and that nothing outside the contract answers with data.
 */
test.describe("M2 Deny by default", () => {
  let params: RouteParams;

  test.beforeAll(async () => {
    const alice = await dbUser("alice");
    const { requestId } = await pendingApprovalCaseFor("alice");
    params = { caseId: await anyCaseAssignedTo("alice"), requestId, analystId: alice.id };
  });

  for (const route of PROTECTED_ROUTES) {
    const deniedRoles = ROLES.filter((role) => MATRIX[route.permission][role] === "none");

    for (const role of deniedRoles) {
      test(`M2: ${role} is denied ${route.name} with 403 even with an invalid body (authorization precedes validation)`, async () => {
        const session = await login(USER_FOR_ROLE[role]);
        const path = route.path(params);
        const response =
          route.method === "GET"
            ? await session.api.get(path, { params: { "invalid-filter": "x".repeat(2000) } })
            : await session.api.post(path, { data: { unexpected: "field" } });
        expect(response.status(), `${role} -> ${route.name}`).toBe(403);
        await dispose(session);
      });
    }

    const [firstDeniedRole] = deniedRoles;
    if (firstDeniedRole) {
      test(`M2: a 403 from ${route.name} carries no record data`, async () => {
        const session = await login(USER_FOR_ROLE[firstDeniedRole]);
        const path = route.path(params);
        const response =
          route.method === "GET" ? await session.api.get(path) : await session.api.post(path, { data: route.body?.(params) ?? {} });
        expect(response.status()).toBe(403);
        const body = await json(response);
        const strings = collectStrings(body);
        expect(strings.some((s) => s === params.caseId || s === params.requestId), "403 body must not echo record ids").toBe(false);
        expect(strings.some((s) => /applicantName|nationalId|riskScore/.test(s)), "403 body must not include record fields").toBe(false);
        await dispose(session);
      });
    }
  }

  const UNDECLARED_ROUTES = [
    { method: "GET", path: () => "/api/kyc" },
    { method: "GET", path: () => "/api/kyc/cases/all" },
    { method: "POST", path: (p: RouteParams) => `/api/kyc/cases/${p.caseId}` },
    { method: "POST", path: (p: RouteParams) => `/api/kyc/cases/${p.caseId}/approve` },
    { method: "POST", path: (p: RouteParams) => `/api/kyc/cases/${p.caseId}/reject` },
    { method: "POST", path: (p: RouteParams) => `/api/kyc/cases/${p.caseId}/status` },
    { method: "POST", path: (p: RouteParams) => `/api/approvals/${p.requestId}` },
    { method: "POST", path: () => "/api/audit" },
    { method: "GET", path: () => "/api/users" },
    { method: "GET", path: () => "/api/admin" },
  ] as const;

  for (const route of UNDECLARED_ROUTES) {
    test(`M2: undeclared route ${route.method} ${route.path({ caseId: ":id", requestId: ":id", analystId: ":id" })} never succeeds`, async () => {
      const admin = await login("dan");
      const path = route.path(params);
      const response =
        route.method === "GET" ? await admin.api.get(path) : await admin.api.post(path, { data: { status: "APPROVED" } });
      expect(response.status(), `${route.method} ${path}`).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      await dispose(admin);
    });
  }

  const ALTERNATE_METHODS = ["PUT", "PATCH", "DELETE"] as const;

  for (const method of ALTERNATE_METHODS) {
    test(`M2: ${method} on a contract route never succeeds`, async () => {
      const admin = await login("dan");
      const targets = [
        `/api/kyc/cases/${params.caseId}`,
        `/api/kyc/cases/${params.caseId}/assign`,
        `/api/approvals/${params.requestId}/decide`,
        "/api/audit",
      ];
      for (const path of targets) {
        const response = await admin.api.fetch(path, { method, data: { status: "APPROVED" } });
        expect(response.status(), `${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(response.status(), `${method} ${path}`).toBeLessThan(500);
      }
      await dispose(admin);
    });
  }

  test("M2: state-changing routes reject GET (no state change via GET)", async () => {
    const [dan, alice, carol] = await Promise.all([login("dan"), login("alice"), login("carol")]);
    const attempts = [
      dan.api.get(`/api/kyc/cases/${params.caseId}/assign`, { params: { analystId: params.analystId } }),
      alice.api.get(`/api/kyc/cases/${params.caseId}/start-review`),
      alice.api.get(`/api/kyc/cases/${params.caseId}/recommend`, { params: { recommendation: "approve", note: "via GET" } }),
      carol.api.get(`/api/approvals/${params.requestId}/decide`, { params: { decision: "confirm", note: "via GET" } }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status(), response.url()).toBeGreaterThanOrEqual(400);
      expect(response.status(), response.url()).toBeLessThan(500);
    }
    await dispose(dan, alice, carol);
  });
});
