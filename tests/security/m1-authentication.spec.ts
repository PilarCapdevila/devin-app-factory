import { test, expect } from "@playwright/test";
import { anonymous, dispose, login, logout, withCookies } from "./helpers/api";
import { BASE_URL } from "./helpers/config";
import { PLACEHOLDER_PARAMS, PROTECTED_PAGES, PROTECTED_ROUTES, SESSION_ONLY_ROUTES } from "./helpers/routes";
import { USERS } from "./helpers/users";

test.describe("M1 Authentication everywhere", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`M1: unauthenticated ${route.name} returns 401`, async () => {
      const api = await anonymous();
      const path = route.path(PLACEHOLDER_PARAMS);
      const response =
        route.method === "GET"
          ? await api.get(path)
          : await api.post(path, { data: route.body?.(PLACEHOLDER_PARAMS) ?? {} });
      expect(response.status(), `${route.name} without a session`).toBe(401);
      await dispose(api);
    });
  }

  for (const route of SESSION_ONLY_ROUTES) {
    test(`M1: unauthenticated ${route.name} returns 401`, async () => {
      const api = await anonymous();
      const response = route.method === "GET" ? await api.get(route.path) : await api.post(route.path);
      expect(response.status()).toBe(401);
      await dispose(api);
    });
  }

  for (const page of PROTECTED_PAGES) {
    test(`M1: unauthenticated page request to ${page} redirects to /login`, async () => {
      const api = await anonymous();
      const response = await api.get(page, { maxRedirects: 0, headers: { accept: "text/html" } });
      expect([301, 302, 303, 307, 308], `expected a redirect for ${page}, got ${response.status()}`).toContain(
        response.status(),
      );
      const location = response.headers()["location"] ?? "";
      expect(new URL(location, BASE_URL).pathname).toBe("/login");
      await dispose(api);
    });
  }

  test("M1: /login is reachable without a session", async () => {
    const api = await anonymous();
    const response = await api.get("/login", { maxRedirects: 0, headers: { accept: "text/html" } });
    expect(response.status()).toBe(200);
    await dispose(api);
  });

  test("M1: login with a wrong password returns 401 and grants no session", async () => {
    const api = await anonymous();
    const response = await api.post("/api/auth/login", {
      data: { email: USERS.alice.email, password: "definitely-not-the-password" },
    });
    expect(response.status()).toBe(401);
    const cookies = await api.storageState();
    expect(cookies.cookies, "no session cookie must be set after a failed login").toHaveLength(0);
    const cases = await api.get("/api/kyc/cases");
    expect(cases.status()).toBe(401);
    await dispose(api);
  });

  test("M1: login for an unknown user returns 401", async () => {
    const api = await anonymous();
    const response = await api.post("/api/auth/login", {
      data: { email: "nobody@example.com", password: "whatever-password" },
    });
    expect(response.status()).toBe(401);
    await dispose(api);
  });

  test("M1: a forged session cookie is rejected with 401", async () => {
    const real = await login("alice");
    const state = await real.api.storageState();
    expect(state.cookies.length, "login must set a session cookie").toBeGreaterThan(0);
    const forged = await withCookies(
      state.cookies.map((cookie) => ({ ...cookie, value: `${cookie.value.slice(0, -4)}XXXX` })),
    );
    const response = await forged.get("/api/kyc/cases");
    expect(response.status()).toBe(401);
    await dispose(real, forged);
  });

  test("M1: a valid session is accepted, and logout invalidates it", async () => {
    const alice = await login("alice");
    const before = await alice.api.get("/api/kyc/cases");
    expect(before.status()).toBe(200);

    const out = await logout(alice);
    expect(out.ok()).toBe(true);

    const after = await alice.api.get("/api/kyc/cases");
    expect(after.status(), "session must be unusable after logout").toBe(401);
    await dispose(alice);
  });

  test("M1: every seeded user can log in", async () => {
    for (const key of ["alice", "bob", "carol", "dan", "erin"] as const) {
      const session = await login(key);
      const response = await session.api.get("/api/kyc/cases");
      expect(response.status(), `${key} is authenticated`).toBe(200);
      await dispose(session);
    }
  });
});
