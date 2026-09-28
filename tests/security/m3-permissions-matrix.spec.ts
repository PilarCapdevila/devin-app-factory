import { test, expect, type APIResponse } from "@playwright/test";
import { asArray, dispose, hostCookie, idsOf, json, login, withCookies, type Session } from "./helpers/api";
import {
  anyCaseAssignedTo,
  inReviewCaseFor,
  newCaseAssignedTo,
  newCaseForAssignment,
  pendingApprovalCaseFor,
} from "./helpers/cases";
import { dbUser } from "./helpers/db";
import { MATRIX, PROTECTED_ROUTES, routeNamed, type ProtectedRoute, type RouteParams } from "./helpers/routes";
import { ROLES, USER_FOR_ROLE, otherAnalyst, type Role } from "./helpers/users";

const ANALYST = "alice" as const;
const OTHER_ANALYST = otherAnalyst(ANALYST);

/**
 * Prepares live parameters so that an *allowed* call to `route` is in a valid workflow state.
 * `owner` is the analyst whose case should be targeted.
 */
async function paramsFor(route: ProtectedRoute, owner: "alice" | "bob", fresh = false): Promise<RouteParams> {
  const analystId = (await dbUser(ANALYST)).id;
  const pending = async () => pendingApprovalCaseFor(owner, { fresh });
  switch (route.name) {
    case "POST /api/kyc/cases/:id/assign":
      return { caseId: await newCaseForAssignment(), requestId: "", analystId };
    case "POST /api/kyc/cases/:id/start-review":
      return { caseId: await newCaseAssignedTo(owner), requestId: "", analystId };
    case "POST /api/kyc/cases/:id/recommend":
      return { caseId: await inReviewCaseFor(owner), requestId: "", analystId };
    case "POST /api/approvals/:id/decide": {
      const { caseId, requestId } = await pending();
      return { caseId, requestId, analystId };
    }
    default:
      return { caseId: await anyCaseAssignedTo(owner), requestId: "", analystId };
  }
}

async function call(session: Session, route: ProtectedRoute, params: RouteParams): Promise<APIResponse> {
  const path = route.path(params);
  return route.method === "GET" ? session.api.get(path) : session.api.post(path, { data: route.body?.(params) ?? {} });
}

test.describe("M3 Server-side permissions: every role against every route", () => {
  for (const role of ROLES) {
    for (const route of PROTECTED_ROUTES) {
      const grant = MATRIX[route.permission][role];

      if (grant === "none") {
        test(`M3: ${role} is denied ${route.name} (${route.permission}) with 403`, async () => {
          const params = await paramsFor(route, ANALYST);
          const session = await login(USER_FOR_ROLE[role]);
          const response = await call(session, route, params);
          expect(response.status(), `${role} -> ${route.name}`).toBe(403);
          await dispose(session);
        });
      }

      if (grant === "all") {
        test(`M3: ${role} is allowed ${route.name} (${route.permission})`, async () => {
          const params = await paramsFor(route, ANALYST, true);
          const session = await login(USER_FOR_ROLE[role]);
          const response = await call(session, route, params);
          expect(response.status(), `${role} -> ${route.name}: ${await response.text()}`).toBe(200);
          await dispose(session);
        });
      }

      if (grant === "assigned") {
        test(`M3: ${role} is allowed ${route.name} (${route.permission}) on an assigned case`, async () => {
          const params = await paramsFor(route, ANALYST);
          const session = await login(USER_FOR_ROLE[role]);
          const response = await call(session, route, params);
          expect(response.status(), `${role} -> ${route.name}: ${await response.text()}`).toBe(200);
          await dispose(session);
        });

        if (route.caseScoped) {
          test(`M3: ${role} gets 404 from ${route.name} (${route.permission}) on a case assigned to someone else`, async () => {
            const params = await paramsFor(route, OTHER_ANALYST);
            const session = await login(USER_FOR_ROLE[role]);
            const response = await call(session, route, params);
            expect(response.status(), `${role} -> ${route.name} on ${OTHER_ANALYST}'s case`).toBe(404);
            await dispose(session);
          });
        }
      }
    }
  }

  test("M3: the analyst's case list contains only cases assigned to them", async () => {
    const alice = await login(ANALYST);
    const aliceId = (await dbUser(ANALYST)).id;
    const response = await alice.api.get("/api/kyc/cases");
    expect(response.status()).toBe(200);
    const cases = asArray(await json(response), "case list");
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(item).toMatchObject({ assignedToId: aliceId });
    }
    await dispose(alice);
  });

  test("M3: only the approver's inbox lists pending KYC decisions", async () => {
    const { requestId } = await pendingApprovalCaseFor(ANALYST);
    for (const role of ROLES) {
      const session = await login(USER_FOR_ROLE[role]);
      const response = await session.api.get("/api/approvals");
      if (MATRIX["kyc.case.decide"][role] === "all") {
        expect(response.status(), `${role} inbox`).toBe(200);
        const ids = idsOf(asArray(await json(response), "inbox"));
        expect(ids, `${role} inbox lists the pending request`).toContain(requestId);
      } else {
        // Non-deciders get either an empty inbox or an explicit denial, never someone else's work.
        expect([200, 403], `${role} inbox status`).toContain(response.status());
        if (response.status() === 200) {
          expect(asArray(await json(response), "inbox"), `${role} inbox must be empty`).toHaveLength(0);
        }
      }
      await dispose(session);
    }
  });
});

test.describe("M3 Role comes from the server-side session, never from client input", () => {
  interface Escalation {
    name: string;
    role: Role;
    route: ProtectedRoute;
  }

  const escalations: Escalation[] = [
    { name: "analyst -> audit log", role: "analyst", route: routeNamed("GET /api/audit") },
    { name: "admin -> decide", role: "admin", route: routeNamed("POST /api/approvals/:id/decide") },
    { name: "admin -> reveal", role: "admin", route: routeNamed("POST /api/kyc/cases/:id/reveal") },
    { name: "auditor -> assign", role: "auditor", route: routeNamed("POST /api/kyc/cases/:id/assign") },
  ];

  const spoofedHeaders: Record<string, string> = {
    "x-role": "admin",
    "x-user-role": "approver",
    "x-forwarded-user": "carol@example.com",
    "x-user-id": "carol",
    authorization: "Bearer admin",
  };

  for (const { name, role, route } of escalations) {
    test(`M3: ${name} stays 403 with spoofed role headers`, async () => {
      const params = await paramsFor(route, ANALYST);
      const session = await login(USER_FOR_ROLE[role]);
      const path = route.path(params);
      const response =
        route.method === "GET"
          ? await session.api.get(path, { headers: spoofedHeaders })
          : await session.api.post(path, { headers: spoofedHeaders, data: route.body?.(params) ?? {} });
      expect(response.status()).toBe(403);
      await dispose(session);
    });

    test(`M3: ${name} stays denied with a role in the query string and body`, async () => {
      const params = await paramsFor(route, ANALYST);
      const session = await login(USER_FOR_ROLE[role]);
      const path = route.path(params);
      const spoof = { role: "admin", roles: ["admin", "approver"], user: { role: "approver" }, isAdmin: true };
      const response =
        route.method === "GET"
          ? await session.api.get(path, { params: { role: "admin", as: "carol@example.com" } })
          : await session.api.post(`${path}?role=admin`, { data: { ...(route.body?.(params) ?? {}), ...spoof } });
      // 403 (permission checked first) or 400 (unknown fields rejected); never a success.
      expect([400, 403], `${name} with spoofed role in input`).toContain(response.status());
      await dispose(session);
    });
  }

  test("M3: a spoofed role cookie alongside the real session does not escalate", async () => {
    const alice = await login("alice");
    const { cookies } = await alice.api.storageState();
    const spoofed = await withCookies([
      ...cookies,
      hostCookie("role", "admin"),
      hostCookie("user", JSON.stringify({ email: "dan@example.com", role: "admin" })),
    ]);
    expect((await spoofed.get("/api/kyc/cases")).status(), "real session still works").toBe(200);
    const response = await spoofed.get("/api/audit");
    expect(response.status()).toBe(403);
    await dispose(alice, spoofed);
  });
});
